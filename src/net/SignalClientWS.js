export class SignalClientWS {
  constructor(url){ this.url = url; this.ws = null; this.handlers = new Map(); }
  on(type, fn){ this.handlers.set(type, fn); }
  async connect(){
    return new Promise((resolve, reject)=>{
      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.onopen = ()=>resolve();
      ws.onerror = (e)=>reject(e);
      ws.onmessage = (ev)=>{
        let msg; try{ msg = JSON.parse(ev.data);}catch(_){return;}
        const fn = this.handlers.get(msg.type);
        if (fn) fn(msg);
      };
    });
  }
  send(obj){ if (this.ws && this.ws.readyState===1) this.ws.send(JSON.stringify(obj)); }
  close(){ try{ this.ws?.close(); }catch(_){} }
}
