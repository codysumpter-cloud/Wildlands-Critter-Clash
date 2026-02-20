import { SignalClientWS } from './SignalClientWS.js';
import { NetTransportWebRTC } from './NetTransportWebRTC.js';

export class LobbyManager {
  constructor({ signalingUrl, iceServers }){
    this.signalingUrl = signalingUrl;
    this.iceServers = iceServers||[];
    this.signal = null;
  }
  async connect(){
    this.signal = new SignalClientWS(this.signalingUrl);
    await this.signal.connect();
    return this;
  }
}
