export class NetTransportWebRTC {
  constructor({ iceServers }){ this.iceServers = iceServers||[]; this.pc=null; this.dc=null; this.onMsg=null; }
  async makePeer(isHost){
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    this.pc = pc;
    if (isHost){
      const dc = pc.createDataChannel('wildlands', { ordered:true });
      this._wireDC(dc);
    } else {
      pc.ondatachannel = (ev)=> this._wireDC(ev.channel);
    }
    return pc;
  }
  _wireDC(dc){
    this.dc = dc;
    dc.onmessage = (ev)=>{ if (this.onMsg) this.onMsg(ev.data); };
  }
  send(str){ if (this.dc && this.dc.readyState==='open') this.dc.send(str); }
  close(){ try{ this.dc?.close(); }catch(_){} try{ this.pc?.close(); }catch(_){} }
}
