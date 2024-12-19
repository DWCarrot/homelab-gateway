<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { context } from "../context";
import { WebRTCServiceStatus, DemoNegotiator, ConnectionInfo } from "../webrtcsvc";
import { Input, Button, Row, Col } from "ant-design-vue";
import { StarOutlined } from "@ant-design/icons-vue";

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
            return "Connect";
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
            return "Disconnect";
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

const connectingExtInfo = ref<string>("");
const connectionError = ref<string>("");

let pc: RTCPeerConnection | null = null;

function onWebRTCConnectionStateChange(ev: Event) {
    const pc = ev.target as RTCPeerConnection;
    switch (pc.iceConnectionState) {
        case "checking":
            connectingExtInfo.value = "ICE Checking";
            break;
        case "connected":
            connectingExtInfo.value = "ICE Connected";
            break;
        default:
            break;
    }
}

function onWebRTCICEGatheringStateChange(ev: Event) {
    const pc = ev.target as RTCPeerConnection;
    switch (pc.iceGatheringState) {
        case "gathering":
            connectingExtInfo.value = "ICE Gathering";
            break;
        case "complete":
            connectingExtInfo.value = "ICE Gathered";
            break;
        default:
            break;
    }
}

function onWebRTCServiceStatusChange(s: WebRTCServiceStatus) {
    console.debug("WebRTCController onWebRTCServiceStatusChange", s);
    status.value = s;
}

context.webrtc.onStatusChange(onWebRTCServiceStatusChange);

context.webrtc.registerPeerConnection(
    function (peer: RTCPeerConnection) {
        pc = peer;
        peer.addEventListener("iceconnectionstatechange", onWebRTCConnectionStateChange);
        peer.addEventListener("icegatheringstatechange", onWebRTCICEGatheringStateChange);
        status.value = peer.connectionState;
    },
    function (peer: RTCPeerConnection) {
        peer.removeEventListener("icegatheringstatechange", onWebRTCICEGatheringStateChange);
        peer.removeEventListener("iceconnectionstatechange", onWebRTCConnectionStateChange);
        pc = null;
        status.value = "idle";
    },
    1
);


function execute() {
    if (status.value === "idle") {
        console.debug("WebRTCController execute Create");
        context.webrtc.create(context.config.webrtc);
        setTimeout(execute, 500);
    } else if (status.value === "new") {
        if (info.channelId && info.localId) {
            console.debug("WebRTCController execute Connect", info.channelId, info.localId);
            const negotiator = new DemoNegotiator(info.localId, info.channelId);
            context.webrtc.connect(negotiator, context.config.offer)
                .then(resp => Object.assign(info, resp))
                .catch(err => {
                    connectionError.value = err;
                });
            status.value = "connecting";
        }
    } else if (status.value === "connected") {
        console.debug("WebRTCController execute Disconnect");
        context.webrtc.close();
        setTimeout(execute, 1000);
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
        <Row align="middle" v-bind:gutter="16">
            <Col>
                <Button v-bind:loading="btnDisabled" v-on:click="execute">{{ btnText }}</button>
            </Col>
            <Col>
                <span v-if="status === 'connecting'">{{ connectingExtInfo }}</span>
                <span v-if="status === 'connected'">
                    <span v-if="info.primary">
                        <StarOutlined />
                    </span>
                    <span>{{ info.localId }}</span>
                    <span>
                        &lt;===&gt;
                    </span>
                    <span>{{ info.remoteId }}</span>
                </span>
                <span v-if="status === 'failed'">{{ connectionError }}</span>
            </Col>
        </Row>
    </div>
</template>

<style scoped>
.input-webrtc {
    width: 25em;
}
</style>