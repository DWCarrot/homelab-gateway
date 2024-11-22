<script setup lang="ts">
import { ref, computed, ComputedRef, onMounted } from 'vue'
import { executePing, ServerListPingResult } from './ping';
import "./TextComponent.vue"
import TextComponent from './TextComponent.vue';
import { getVersions, ProtocolElement } from './protocol-versions';

interface SocketAddress {
  host: string;
  port?: number;
}

const address = ref<string>('')
const socketAddr: ComputedRef<SocketAddress | null> = computed(() => {
  try {
    let s = address.value.trim();
    if (s === '') {
      return null;
    }
    let url = new URL(`https://${s}/`);
    if (url.protocol === 'https:' && url.username === '' && url.password === '' && url.pathname === '/' && url.search === '' && url.hash === '') {
      let host = url.hostname;
      if (host.startsWith('[') && host.endsWith(']')) {
        host = host.substring(1, host.length - 1);
      }
      let port = url.port === '' ? undefined : parseInt(url.port);
      return { host, port };
    }
  } catch (e) {
    console.debug(e);
  }
  return null;
});
const forceUpdateDNS = ref<boolean>(false);
const pingStatus = ref<string>('')
const pingResult = ref<ServerListPingResult | undefined>();
const pingResultShowSample = ref<boolean>(false);

const versionsData :{[name: string]: ProtocolElement} = {};
const versions = ref<string[]>([]);

const versionName = ref<string|undefined>();

const version: ComputedRef<number|undefined> = computed(() => {
  if (versionName.value) {
    let data = versionsData[versionName.value];
    if (data) {
      return data.protocol_id || undefined;
    }
  }
  return undefined;
});

function ping() {
  if (!socketAddr.value) {
    pingStatus.value = ''
    return;
  }
  pingResult.value = undefined;
  let { host, port } = socketAddr.value;
  port = port || 25565;
  let ver = version.value;
  pingStatus.value = `executing ping of host=${host} port=${port} version=${ver} ...`;
  executePing(host, port, forceUpdateDNS.value, ver, undefined, 5000)
    .then((result: ServerListPingResult) => {
      pingStatus.value = '';
      pingResult.value = result;
      pingResultShowSample.value = false;
    })
    .catch(e => {
      pingStatus.value = `error: ${e}`;
    })
}

function flipShowSampleState() {
  pingResultShowSample.value = !pingResultShowSample.value;
}

onMounted(async() => {
  let list = versions.value;
  const elements = await getVersions();
  for (const element of elements) {
    versionsData[element.name] = element;
    list.push(element.name);
  }
  console.log(versions.value);
});
</script>

<template>
  <h1>Minecraft Protocol Ping</h1>
  <div class="mcping-ctrl">
    <form v-on:submit="ping" onsubmit="return false;">
      <div class="mcping-ctrl-input">
        <span>
          <label>Server</label>
          <input id="address" name="address" type="text" v-model="address" placeholder="server address"
            class="mcping-input-address" v-bind:class="{ 'mcping-input-error': address && !socketAddr }" />
        </span>
        <span>
          <label>Version</label>
          <input list="mcping_input_verion_list" id="version" name="version" v-model="versionName" />
          <datalist id="mcping_input_verion_list">
            <option v-for="version in versions" v-bind:value="version"></option>
          </datalist>
        </span>
        <span>
          <input id="flushdns" name="flushdns" type="checkbox" v-model="forceUpdateDNS">
          <label>flushdns</label>
        </span>
      </div>
      <div class="mcping-ctrl-btn">
        <button type="submit">Ping</button>
      </div>
    </form>
  </div>
  <div class="mcping-display">
    <div class="mcping-result" v-if="pingResult">
      <div class="mcping-result-left">
        <div class="mcping-result-favicon">
          <img v-if="pingResult.status.favicon" v-bind:src="pingResult.status.favicon" />
        </div>
      </div>
      <div class="mcping-result-middle">
        <div class="mcping-result-version">
          <span>{{ pingResult.status.version.name }}</span>
          <span>({{ pingResult.status.version.protocol }})</span>
        </div>
        <div class="mcping-result-description">
          <TextComponent v-if="pingResult.status.description" v-bind:data="pingResult.status.description">
          </TextComponent>
        </div>
      </div>
      <div class="mcping-result-right">
        <div class="mcping-result-ping">
          <span v-if="pingResult.ping">{{ pingResult.ping }} ms</span>
        </div>
        <div class="mcping-result-players">
          <div class="mcping-result-players-general" v-if="pingResult.status.players">
            <span>{{ pingResult.status.players.online }}/{{ pingResult.status.players.max }}</span>
            <span class="hover-expand" v-if="pingResult.status.players.sample" v-on:click="flipShowSampleState">
              {{ pingResultShowSample ? "▽" : "◀" }}
            </span>
          </div>
          <div class="mcping-result-players-samples" v-if="pingResult.status.players?.sample && pingResultShowSample">
            <ul class="mcping-result-players-samples-list">
              <li v-for="player in pingResult.status.players.sample" class="item-content">
                <span>{{ player.name || "???" }}</span>
                <span class="item-tooltiptext">{{ player.id }}</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
    <div class="mcping-status">
      <div v-if="pingStatus">
        <pre> {{ pingStatus }} </pre>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mcping-input-address {
  width: 20em;
  margin-left: 0.5em;
  margin-right: 0.5em;
}

.mcping-input-error {
  border-width: 2px;
  border-color: red;
  border-style: solid;
}

.mcping-ctrl-input {
  margin-right: 5px;
}



.mcping-result {
  display: flex;
  align-items: flex-start;
  width: min-content;
  background-color: darkgray;
}

.mcping-result-left {
  display: flex;
  flex-direction: column;
}

.mcping-result-version {
  margin-bottom: auto;
}

.mcping-result-description {
  margin-top: auto;
}

.mcping-result-players {
  position: relative;
}

.mcping-result-players-samples {
  position: absolute;
  left: 2px;
  top: 20px;
}

.mcping-result-players-samples-list {
  list-style: none;
  margin: 2px;
  padding: 0;
}

.item-content {
  position: relative;
  display: inline-block;
  cursor: pointer;
}

.item-content .item-tooltiptext {
  visibility: hidden;
  background-color: darkslategray;
  color: #fff;
  text-align: center;
  border-radius: 5px;
  padding: 5px;
  position: absolute;
  z-index: 1;
  bottom: 100%;
  left: -200px;
  margin-left: -30px;
  opacity: 0;
  transition: opacity 0.3s;
  white-space: nowrap;
}

/* .item-content .item-tooltiptext::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 50%;
  margin-left: -5px;
  border-width: 5px;
  border-style: solid;
  border-color: black transparent transparent transparent;
} */

.item-content:hover .item-tooltiptext {
  visibility: visible;
  opacity: 1;
}

.hover-expand {
  cursor: pointer;
}
</style>
