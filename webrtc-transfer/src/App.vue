<script setup lang="ts">
import WebRTCController from "./components/WebRTCController.vue";
import TextTransfer from "./components/TextTransfer.vue";
import ConfigPanel from "./components/ConfigPanel.vue";
import FileTransfer from "./components/FileTransfer.vue";
import { ref } from "vue";
import { Configuration, context } from "./context";
import { Divider, message } from "ant-design-vue";

const isConfigPanelVisible = ref(false);

function loadConfig(cfg: Configuration) {
    console.log("Loaded configuration");
    context.config = cfg;
}

function saveConfig(cfg: Configuration) {
    console.log("Saved configuration");
    message.success("Configuration saved");
    context.config = cfg;
}

function cancelConfig() {
    console.log("Cancelled configuration");
}

</script>

<template>
    <button v-on:click="isConfigPanelVisible = true">Open Configuration</button>
    
    <ConfigPanel v-bind:display="isConfigPanelVisible" v-on:close="isConfigPanelVisible = false" v-on:load="loadConfig"
        v-on:save="saveConfig" v-on:cancel="cancelConfig" />
    <Divider>WebRTCController</Divider>
    <WebRTCController />
    <Divider>TextTransfer</Divider>
    <TextTransfer channel-name="chtext" />
    <Divider>FileTransfer</Divider>
    <FileTransfer channel-name="chfile" />
</template>

<style scoped>
.logo {
    height: 6em;
    padding: 1.5em;
    will-change: filter;
    transition: filter 300ms;
}

.logo:hover {
    filter: drop-shadow(0 0 2em #646cffaa);
}

.logo.vue:hover {
    filter: drop-shadow(0 0 2em #42b883aa);
}
</style>
