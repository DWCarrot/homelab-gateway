<script setup lang="ts">
import { createVNode, defineProps, ref } from "vue";
import { Dual } from "../webrtcsvc";
import { context, generateUUID } from "../context";
import { Modal, Row, Col } from "ant-design-vue";
import { InboxOutlined } from "@ant-design/icons-vue";
import { FileType, UploadFile } from "ant-design-vue/es/upload/interface";
import { BasicFileWriter, FileReceiveService, FileSend, FileInfo, IFileWriter, ProgressCallback } from "../fileoperator";

const props = defineProps<{
    channelName: string;
}>();

type Status = 0 | 1 | 2; // 0: idle, 1: opened, 2: closed
interface ProgressDisplay {
    step: string;
    round: number;
    acc: number;
    total: number;
}

const maxlength = 16 * 1024;
const status = ref<Status>(0);
const channelNameRX = ref<string>("");
const channelNameTX = ref<string>("");
let chRX: RTCDataChannel | undefined = undefined;
let chTX: RTCDataChannel | undefined = undefined;
const uploadFile = ref<FileType>();
const transfering = ref(false);
const progressSend = ref<ProgressDisplay>();
const progressRecv = ref<ProgressDisplay>();

let tgtSendFile: File | undefined = undefined;
let sender: FileSend | undefined = undefined;
let receiver: FileReceiveService | undefined = undefined;



function onInputFileChange(e: Event) {
    const target = e.target as HTMLInputElement;
    if (target.files && target.files.length > 0) {
        tgtSendFile = target.files[0];
        console.log("Selected file", tgtSendFile.name);
    }
}

function beforeUpload(file: FileType, fileList: FileType[]) {
    uploadFile.value = file;
    return false;
};

function handleRemove(file: UploadFile) {
    uploadFile.value = undefined;
}

function updateRecvProgress(step: string, round: number, acc: number, total: number) {
    progressRecv.value = { step, round, acc, total };
}

function updateSendProgress(step: string, round: number, acc: number, total: number) {
    progressSend.value = { step, round, acc, total };
}


async function handleUpload() {
    if (tgtSendFile && chTX) {
        const fileUUID = generateUUID();
        sender = new FileSend(tgtSendFile, fileUUID, chTX, maxlength);
        transfering.value = true;
        progressSend.value = { step: "", round: 0, acc: 0, total: tgtSendFile.size };
        let r = await sender.send(updateSendProgress);
        if (r) {
            console.log("Send success");
        } else {
            console.log("Send failed");
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
                    createVNode("p", {}, `Size: ${fileInfo.size}`),
                    createVNode("p", {}, `Type: ${fileInfo.type}`),
                    createVNode("p", {}, `Last Modified: ${new Date(fileInfo.lastModified)}`)
                ]
            ),
            onOk() {
                const writer = new BasicFileWriter(downloadFile);
                progressRecv.value = { step: "", round: 0, acc: 0, total: fileInfo.size };
                resolve([writer, updateRecvProgress]);
            },
            onCancel() {
                resolve(undefined);
            }
        });
    });
}

function onConstruct(dc: Dual<RTCDataChannel>) {
    chRX = dc.rx;
    chTX = dc.tx;
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
    chRX = undefined;
    chTX = undefined;
}

context.webrtc.registerDataChannel(props.channelName, onConstruct, onDestruct, 3, { ordered: false });

</script>


<template>
    <div v-if="status > 0">
        <Row align="middle">
            <span v-if="status === 1">
                <span>🟢</span>
                <span>{{ channelNameTX }}</span>
                <span>===> | ===></span>
                <span>{{ channelNameRX }}</span>
            </span>
            <span v-if="status === 2">🟡</span>
        </Row>
        <Row v-if="status > 0">
            <Col flex="9">
                <input type="file" v-on:change="onInputFileChange" />
            </Col>
            <Col flex="1"> </Col>
            <Col flex="9">

            </Col>
        </Row>
        <Row>
            <Col flex="9">
                <button v-on:click="handleUpload">Upload</button>
                <div>{{ uploadFile?.name }}</div>
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
                    <div class="progress-simple">
                        <span>{{ progressSend.step }}</span>
                        <span>round: {{ progressSend.round }}</span>
                        <span>{{ ((progressSend.acc / progressSend.total) * 100.0).toFixed(1) }} %</span>
                    </div>
                </div>
            </Col>
            <Col flex="1"> </Col>
            <Col flex="9">
                <div v-if="progressRecv">
                    <div>Receive Progress</div>
                    <div class="progress-simple">
                        <span>{{ progressRecv.step }}</span>
                        <span>round: {{ progressRecv.round }}</span>
                        <span>{{ ((progressRecv.acc / progressRecv.total) * 100.0).toFixed(1) }} %</span>
                    </div>
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