<script setup lang="ts">
import { defineProps, ref } from "vue";
import { context } from "../context";
import { Dual } from "../webrtcsvc";
import { Button, Textarea, Row, Col } from "ant-design-vue";

const props = defineProps<{
    channelName: string;
}>();

type Status = 0 | 1 | 2; // 0: idle, 1: opened, 2: closed

const maxlength = 1024;
const status = ref<Status>(0);
const inputText = ref<string>("");
const outputText = ref<string>("");
const channelName = ref<string>(props.channelName);

let dataChannel: RTCDataChannel | undefined = undefined;

function executeSend() {
    if (dataChannel) {
        console.log("send", inputText.value);
        dataChannel.send(inputText.value);
    }
}

function bindDataChannel(ch: RTCDataChannel) {
    ch.onclose = (ev: Event) => {
        status.value = 2;
    };
    ch.onclosing = (ev: Event) => {
        status.value = 2;
    };
    ch.onbufferedamountlow = (ev: Event) => {
        const _dc = ev.target as RTCDataChannel;
        console.log("bufferedamountlow", _dc.bufferedAmountLowThreshold, _dc.bufferedAmount);
    };
    ch.onmessage = (ev: MessageEvent) => {
        console.log("message", ev.data);
        outputText.value = ev.data;
    };
}

function unbindDataChannel(ch: RTCDataChannel) {
    ch.onopen = null;
    ch.onclose = null;
    ch.onclosing = null;
    ch.onbufferedamountlow = null;
    ch.onmessage = null;
}

function pickDataChannel(dc: Dual<RTCDataChannel>): RTCDataChannel {
    if (dc.rx) {
        return dc.rx.label > dc.tx.label ? dc.rx : dc.tx;
    } else {
        return dc.tx;
    }
}

function onConstruct(dc: Dual<RTCDataChannel>) {
    dataChannel = pickDataChannel(dc);
    bindDataChannel(dataChannel);
    status.value = 1;
    channelName.value = dataChannel.label;
}

function onDestruct(dc: Dual<RTCDataChannel>) {
    status.value = 0;
    unbindDataChannel(dataChannel!);
    dataChannel = undefined;
}

context.webrtc.registerDataChannel(props.channelName, onConstruct, onDestruct, 2);


</script>

<template>
    <div v-if="status > 0">
        <Row align="middle">
            <span v-if="status === 1">
                <span>🟢</span>
                <span>{{ channelName }}</span>
            </span>
            <span v-if="status === 2">🟡</span>
        </Row>
        <Row v-if="status > 0">
            <Col flex="9">
                <Textarea v-model:value="inputText" class="text-transfer-textarea" show-count
                    v-bind:maxlength="maxlength"></textarea>
                <div>
                    <Button v-bind:disabled="status !== 1" v-on:click="executeSend">Send</button>
                </div>
            </Col>
            <Col flex="1"> </Col>
            <Col flex="9">
                <Textarea v-model:value="outputText" class="text-transfer-textarea" show-count
                    v-bind:maxlength="maxlength"></textarea>
                <div>Receive</div>
            </Col>
        </Row>
    </div>
</template>


<style scoped>
.text-transfer-textarea {
    height: 10em;
}
</style>