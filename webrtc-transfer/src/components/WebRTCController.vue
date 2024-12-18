<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { context } from "../context";
import { WebRTCServiceStatus, DemoNegotiator, ConnectionInfo } from "../webrtcsvc";
import { Input, Button, Row, Col } from "ant-design-vue";

interface MutableConnectionInfo extends ConnectionInfo {
    localId: string;
    remoteId: string;
    channelId: string;
    primary: boolean;
}

const info = reactive<MutableConnectionInfo>({
    localId: context.webrtc.uuid,
    remoteId: "",
    channelId: "1137",
    primary: true,
});
const status = ref<WebRTCServiceStatus>("idle");

const btnText = computed(() => {
    switch (status.value) {
        case "idle":
            return "Create";
        case "new":
            return "Connect";
        case "connected":
            return "Disconnect";
        case "connecting":
            return "Connecting...";
        case "closing":
            return "Disconnecting...";
        case "closed":
        case "disconnected":
        case "failed":
            return "Reset";
        default:
            return "";
    }
});

const btnDisabled = computed(() => {
    switch (status.value) {
        case "connecting":
        case "closing":
            return true;
        default:
            return false;
    }
});

let pc: RTCPeerConnection | null = null;

function onWebRTCConnectionStateChange(ev: Event) {

}

function onWebRTCServiceStatusChange(s: WebRTCServiceStatus) {
    console.debug("WebRTCController onWebRTCServiceStatusChange", s);
    status.value = s;
}

context.webrtc.onStatusChange(onWebRTCServiceStatusChange);

context.webrtc.registerPeerConnection(
    function (peer: RTCPeerConnection) {
        pc = peer;
        peer.addEventListener("connectionstatechange", onWebRTCConnectionStateChange);
        status.value = peer.connectionState;
    },
    function (peer: RTCPeerConnection) {
        peer.removeEventListener("connectionstatechange", onWebRTCConnectionStateChange);
        pc = null;
        status.value = "idle";
    },
    1
);


function execute() {
    if (status.value === "idle") {
        console.debug("WebRTCController execute Create");
        context.webrtc.create(context.config.webrtc);
    } else if (status.value === "new") {
        if (info.channelId && info.localId) {
            console.debug("WebRTCController execute Connect", info.channelId, info.localId);
            const negotiator = new DemoNegotiator(info.localId, info.channelId);
            context.webrtc.connect(negotiator, context.config.offer).then(resp => Object.assign(info, resp));
            status.value = "connecting";
        }
    } else if (status.value === "connected") {
        console.debug("WebRTCController execute Disconnect");
        context.webrtc.close();
    } else {
        console.debug("WebRTCController execute Reset");
        context.webrtc.reset();
    }
}

const labelCol = {
    span: 1,
};

const wrapperCol = {
    span: 4,
};

</script>


<template>

    <div>
        <Row align="middle">
            <Col span="1">
            <label>Peer</label>
            </Col>
            <Col span="6">
            <Input v-model:value="info.localId" class="input-webrtc" />
            </Col>
        </Row>
        <Row align="middle">
            <Col span="1">
            <label>Room</label>
            </Col>
            <Col span="6">
            <Input v-model:value="info.channelId" class="input-webrtc" />
            </Col>
        </Row>
        <Row align="middle">
            <Col>
                <Button v-bind:loading="btnDisabled" v-on:click="execute">{{ btnText }}</button>
            </Col>
            <Col>
                <span v-if="status === 'idle'">🔘</span>
                <span v-if="status === 'new' || status === 'disconnected' || status === 'closed'">🔵</span>
                <span v-if="status === 'connecting'">🟡</span>
                <span v-if="status === 'connected'">
                    <span>🟢</span>
                    <span>{{ info.localId }}</span>
                    <span v-if="info.primary">1️⃣</span>
                    <span>
                        &lt;===&gt;
                    </span>
                    <span>{{ info.remoteId }}</span>
                </span>
                <span v-if="status === 'failed'">🔴</span>
            </Col>
        </Row>
    </div>
</template>

<style scoped>
.input-webrtc {
    width: 25em;
}
</style>