import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import { Packet, executePing } from './ping'
import { WebSocketStream } from './wsstream';
import { getVersions } from './protocol-versions'

(window as any)['ping'] = executePing;
(window as any)['getVersion'] = getVersions;
(window as any)['Packet'] = Packet;
(window as any)['WebSocketStream'] = WebSocketStream;

createApp(App).mount('#app')
