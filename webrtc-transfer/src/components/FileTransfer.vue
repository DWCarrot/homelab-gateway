<script setup lang="ts">
import { computed, createVNode, defineProps, Ref, ref } from "vue";
import { Dual } from "../webrtcsvc";
import { context, generateUUID } from "../context";
import { Modal, Row, Col, Button, Progress } from "ant-design-vue";
import { BasicFileWriter, FileReceiveService, FileSend, FileInfo, IFileWriter, ProgressCallback, ProgressStep } from "../filetransfer";

const props = defineProps<{
    channelName: string;
}>();

type Status = 0 | 1 | 2; // 0: idle, 1: opened, 2: closed

type ProgressStatus = "success" | "exception" | "normal" | "active";

interface ProgressDisplay {
    step: string;
    round: number;
    percent: number;
    status: ProgressStatus;
}

const maxlength = 16 * 1024;
const status = ref<Status>(0);
const channelNameRX = ref<string>("");
const channelNameTX = ref<string>("");
let chRX: RTCDataChannel | undefined = undefined;
let chTX: RTCDataChannel | undefined = undefined;
const transfering = ref(false);
const progressSend = ref<ProgressDisplay>();
const progressRecv = ref<ProgressDisplay>();

function showFileSize(size: number) {
    if (size < 1024) {
        return `${size} B`;
    } else if (size < 1024 * 1024) {
        return `${(size / 1024).toFixed(2)} KB`;
    } else {
        return `${(size / 1024 / 1024).toFixed(2)} MB`;
    }
}

let tgtSendFile: File | undefined = undefined;
const tgtSendFileSize = ref<number>(0);
const tgtSendFileSizeDisplay = computed(() => showFileSize(tgtSendFileSize.value));

let sender: FileSend | undefined = undefined;
let receiver: FileReceiveService | undefined = undefined;

function onInputFileChange(e: Event) {
    const target = e.target as HTMLInputElement;
    if (target.files && target.files.length > 0) {
        tgtSendFile = target.files[0];
        tgtSendFileSize.value = tgtSendFile.size;
        console.log("Selected file", tgtSendFile.name);
    }
}

class UpdateProgress {

    tgt: Ref<ProgressDisplay|undefined, ProgressDisplay|undefined>;
    lastUpdate: Date;

    constructor(tgt: Ref<ProgressDisplay|undefined, ProgressDisplay|undefined>) {
        this.tgt = tgt;
        this.lastUpdate = new Date();
    }

    updateProgress(step: ProgressStep, round: number, acc: number, total: number) {
        let status: ProgressStatus;
        switch (step) {
            case "handshake":
                status = "active";
                break;
            case "send":
            case "recv":
                {
                    const now = new Date();
                    if (now.getTime() - this.lastUpdate.getTime() < 1000) {
                        return;
                    }
                    this.lastUpdate = now;
                }
                status = "normal";
                break;
            case "finish":
                status = "success";
                break;
            case "cancel":
                status = "success";
                break;
        }
        this.tgt.value = { step, round, percent: acc / total * 100, status };
    }
}


async function handleUpload() {
    if (tgtSendFile && chTX) {
        const fileUUID = generateUUID();
        sender = new FileSend(tgtSendFile, fileUUID, chTX, maxlength);
        transfering.value = true;
        const u = new UpdateProgress(progressSend);
        try {
            let r = await sender.send(u.updateProgress.bind(u));
            if (r) {
                console.log("Send success");
            } else {
                console.log("Send failed");
            }
        } catch (e) {
            console.error("Send error", e);
        } finally {
            transfering.value = false;
            sender = undefined;
        }
    }
}

function downloadFile(fileInfo: FileInfo, blob: Blob): Promise<void> {
    const container = document.getElementById("vvv-recv") as HTMLDivElement;
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileInfo.name;
        a.textContent = "Download";
        a.addEventListener("click", () => {
            setTimeout(() => {
                URL.revokeObjectURL(url);
                container.removeChild(a);
            }, 120 * 1000);
            resolve();
        });
        container.appendChild(a);
    });
}

function confirmRecvFile(fileInfo: FileInfo): Promise<[IFileWriter, ProgressCallback] | undefined> {
    return new Promise((resolve, reject) => {
        Modal.confirm({
            title: `Receive file ${fileInfo.name}`,
            content: createVNode(
                "div",
                {},
                [
                    createVNode("p", {}, `Name: ${fileInfo.name}`),
                    createVNode("p", {}, `Size: ${showFileSize(fileInfo.size)}`),
                    createVNode("p", {}, `Type: ${fileInfo.type}`),
                    createVNode("p", {}, `Last Modified: ${new Date(fileInfo.lastModified).toLocaleString()}`)
                ]
            ),
            onOk() {
                const writer = new BasicFileWriter(downloadFile);
                const u = new UpdateProgress(progressRecv);
                resolve([writer, u.updateProgress.bind(u)]);
            },
            onCancel() {
                resolve(undefined);
            }
        });
    });
}

function onChannelClose() {
    status.value = 2;
}

function onConstruct(dc: Dual<RTCDataChannel>) {
    chRX = dc.rx;
    chTX = dc.tx;
    chTX.addEventListener("close", onChannelClose);
    channelNameRX.value = chRX?.label || "";
    channelNameTX.value = chTX?.label || "";
    status.value = 1;
    if (chRX) {
        receiver = new FileReceiveService(confirmRecvFile, chRX, maxlength);
    }
}

function onDestruct(dc: Dual<RTCDataChannel>) {
    if (receiver) {
        //receiver.close();
        receiver = undefined;
    }
    status.value = 0;
    channelNameRX.value = "";
    channelNameTX.value = "";
    chTX!.removeEventListener("close", onChannelClose);
    chRX = undefined;
    chTX = undefined;
}

function percentFormatter(percent?: number, successPercent?: number) {
    if (percent !== undefined) {
        return percent.toFixed(2) + "%";
    }
    if (successPercent !== undefined) {
        return successPercent.toFixed(2) + "%";
    }
    return "";
}

context.webrtc.registerDataChannel(props.channelName, onConstruct, onDestruct, 3, { ordered: false });

</script>


<template>
    <div v-if="status > 0">
        <Row align="middle">
            <Col flex="1">
                <span v-if="status === 1">🟢</span>
                <span v-if="status === 2">🟡</span>
            </Col>
            <Col flex="8">
                <span v-if="status === 1">{{ channelNameTX }}</span>
            </Col>
            <Col flex="1"> </Col>
            <Col flex="1"> </Col>
            <Col flex="8">
                <span v-if="status === 1">{{ channelNameRX }}</span>
            </Col>
        </Row>
        <Row v-if="status > 0">
            <Col flex="9">
                <input type="file" v-on:change="onInputFileChange" />
                <Button v-on:click="handleUpload" v-bind:loading="transfering">Upload</Button>
                <span v-if="tgtSendFileSize">{{ tgtSendFileSizeDisplay }}</span>
            </Col>
            <Col flex="1"> </Col>
            <Col flex="9">
                <div id="vvv-recv"></div>
            </Col>
        </Row>
        <Row>
            <Col flex="9">
                <div v-if="progressSend">
                    <div>Send Progress</div>
                    <Progress v-bind:percent="progressSend.percent" v-bind:status="progressSend.status" v-bind:format="percentFormatter" />
                </div>
            </Col>
            <Col flex="1"> </Col>
            <Col flex="9">
                <div v-if="progressRecv">
                    <div>Receive Progress</div>
                    <Progress v-bind:percent="progressRecv.percent" v-bind:status="progressRecv.status" v-bind:format="percentFormatter" />
                </div>
            </Col>
        </Row>
    </div>
</template>

<style scoped>
.progress-simple span {
    margin-left: 5px;
}
</style>