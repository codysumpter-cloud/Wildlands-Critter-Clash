// visualAssembler.js - deterministic attachment selection + draw (no per-frame compositing)
export class VisualAssembler {
  constructor({ assetStore, contentStore, diagnostics, loadJSON }) {
    this._assets = assetStore;
    this._content = contentStore;
    this._diag = diagnostics;
    this._loadJSON = loadJSON;
    this._anchors = null;
    this._anchorCache = new Map(); // creatureId -> dir -> anchorId -> {x,y}
  }

  async init() {
    this._anchors = await this._loadJSON('runtime/anchors.json');
    return this;
  }

  _getAnchor(creatureId, dir, anchorId) {
    const key = `${creatureId}|${dir}|${anchorId}`;
    if (this._anchorCache.has(key)) return this._anchorCache.get(key);
    const c = this._anchors?.[creatureId];
    const d = c?.[dir];
    const a = d?.[anchorId] || null;
    if (!a) this._diag?.state?.missingAnchors?.push(key);
    this._anchorCache.set(key, a);
    return a;
  }

  // Deterministic resolution:
  // - enforce slot caps via SlotContracts
  // - replacesGroup: higher tier replaces lower in group
  // - sort: slot priority -> layerOrder -> attachmentId
  resolveAttachments(creatureId, activeMutations) {
    const sc = this._content.slotContract(creatureId);
    const caps = sc?.slotCaps || {};
    const order = sc?.visualPriorityOrder || ["HEAD_TOP","HEAD_SIDE","CHEST","BACK","AURA","MAIN_HAND","PROJECTILE","ORBIT"];
    const slotPriority = new Map(order.map((s,i)=>[s,i]));

    // Gather attachment candidates
    const cands = [];
    for (const mutId of activeMutations) {
      // Active list may contain either legacy mutationIds OR evolution nodeIds.
      const m = this._content.mutation(mutId);
      const n = m ? null : this._content.evolutionNode?.(mutId);
      const vbs = m
        ? (m.visual_bindings || [])
        : (n ? (n.visuals || []).map(v => ({
            type: 'attachment',
            anchor: v.slot,
            attachmentId: v.attachmentSpriteId,
            layerOrder: v.priority ?? 0,
            replacesGroup: v.exclusiveGroup || null,
            tier: (n.tier != null) ? n.tier : 0,
            offsetX: v.offsetX ?? 0,
            offsetY: v.offsetY ?? 0,
            scale: v.scale ?? 1.0,
            vfxLayer: (String(v.slot||'').toUpperCase() === 'AURA')
          })) : []);

      const ownerSlot = (m?.slot) || null;
      const ownerAttachment = (m?.attachmentSpriteId) || null;
      const vbs2 = (Array.isArray(vbs) && vbs.length)
        ? vbs
        : ((ownerAttachment || ownerSlot) ? [{ type: 'attachment', anchor: ownerSlot, attachmentId: ownerAttachment, layerOrder: 0 }] : []);

      for (const vb of vbs2) {
        if (vb.type !== 'attachment') continue;
        let slot = vb.anchor || vb.slot || ownerSlot || 'CHEST';
        const S = String(slot||'').toUpperCase();
        if (S === 'AURA') slot = 'AURA_CENTER';
        else if (S === 'ORBIT' || S === 'WAIST' || S === 'HEAD_SIDE' || S === 'PROJECTILE') slot = 'CHEST';
        else slot = S;
        const group = vb.replacesGroup || null;
        const tier = vb.tier ?? 0;
        let raw = vb.attachmentId || vb.spriteKey || ownerAttachment;
        if (!raw) continue;

        // Normalize known prefixes.
        if (typeof raw === 'string' && raw.startsWith('attach/')) raw = raw.slice('attach/'.length);

        // Resolve to an actual registered asset id. (attachment.* preferred; fall back to vfx.*)
        const tryIds = [];
        // Accept already-qualified asset ids (attachment.*.sprite / vfx.*.sprite)
        if (typeof raw === 'string' && (raw.startsWith('attachment.') || raw.startsWith('vfx.')) && raw.endsWith('.sprite')) {
          tryIds.push(raw);
        }
        if (typeof raw === 'string') {
          tryIds.push(`attachment.${raw}.sprite`);
          if (raw.startsWith('vfx_')) tryIds.push(`vfx.${raw.slice(4)}.sprite`);
          tryIds.push(`vfx.${raw}.sprite`);
        }
        const resolved = tryIds.find(id => this._assets.get(id));
        if (!resolved) {
          // fail-soft: surface in diagnostics but don't crash
          this._diag?.warn?.('VISUAL_SPRITE_MISSING', { id: raw, owner: mutId });
          continue;
        }

        cands.push({
          mutId,
          slot,
          group,
          tier,
          layerOrder: vb.layerOrder ?? 0,
          attachmentId: String(raw),
          assetId: resolved,
          vfxLayer: !!vb.vfxLayer,
          offsetX: vb.offsetX ?? 0,
          offsetY: vb.offsetY ?? 0,
          scale: vb.scale ?? 1.0
        });
      }
    }

    // replacesGroup resolution (take max tier; tie -> lexicographic attachmentId)
    const bestByGroup = new Map();
    for (const c of cands) {
      if (!c.group) continue;
      const prev = bestByGroup.get(c.group);
      if (!prev || c.tier > prev.tier || (c.tier === prev.tier && c.attachmentId < prev.attachmentId)) bestByGroup.set(c.group, c);
    }
    const filtered = cands.filter(c => !c.group || bestByGroup.get(c.group) === c);

    // Slot caps
    const bySlot = new Map();
    for (const c of filtered) {
      const arr = bySlot.get(c.slot) || [];
      arr.push(c);
      bySlot.set(c.slot, arr);
    }
    const final = [];
    for (const [slot, arr] of bySlot.entries()) {
      arr.sort((a,b)=>{
        const pa = slotPriority.get(a.slot) ?? 999;
        const pb = slotPriority.get(b.slot) ?? 999;
        if (pa!==pb) return pa-pb;
        if (a.layerOrder!==b.layerOrder) return a.layerOrder-b.layerOrder;
        return a.attachmentId.localeCompare(b.attachmentId);
      });
      const cap = caps[slot];
      const take = (cap === undefined) ? arr : arr.slice(0, Math.max(0, cap|0));
      final.push(...take);
    }

    // Global deterministic sort for draw order
    final.sort((a,b)=>{
      const pa = slotPriority.get(a.slot) ?? 999;
      const pb = slotPriority.get(b.slot) ?? 999;
      if (pa!==pb) return pa-pb;
      if (a.layerOrder!==b.layerOrder) return a.layerOrder-b.layerOrder;
      return a.attachmentId.localeCompare(b.attachmentId);
    });

    return final;
  }

  drawCreature(ctx, { creatureId, dir, frameCol, frameRow, x, y, scale=1, activeMutations=[] }) {
    const sheetId = this._assets.creatureSheetAssetId(creatureId);
    const sheet = this._assets.image(sheetId);
    const sheetMeta = this._assets.get(sheetId)?.meta;
    if (!sheet || !sheetMeta) return;

    const cellW = sheetMeta.cellW || 96;
    const cellH = sheetMeta.cellH || 96;

    // base
    ctx.drawImage(
      sheet,
      frameCol * cellW, frameRow * cellH, cellW, cellH,
      Math.round(x - (cellW*scale)/2), Math.round(y - (cellH*scale)/2),
      Math.round(cellW*scale), Math.round(cellH*scale)
    );

    const attachments = this.resolveAttachments(creatureId, activeMutations);
    // surface slot usage to diagnostics
    if (this._diag) {
      const slots = {};
      for (const a of attachments) slots[a.slot] = (slots[a.slot]||0)+1;
      this._diag.state.activeSlots = slots;
    }

    for (const a of attachments) {
      const img = this._assets.image(a.assetId);
      if (!img) continue;
      const anchor = this._getAnchor(creatureId, dir, a.slot) || this._getAnchor(creatureId, dir, "CHEST") || { x: cellW/2, y: cellH/2 };
      const ax = (x - (cellW*scale)/2) + (anchor.x*scale) + (a.offsetX*scale);
      const ay = (y - (cellH*scale)/2) + (anchor.y*scale) + (a.offsetY*scale);
      const w = 64 * scale * a.scale;
      const h = 64 * scale * a.scale;
      ctx.drawImage(img, Math.round(ax - w/2), Math.round(ay - h/2), Math.round(w), Math.round(h));
    }
  }
}
