<script setup lang="ts">
import { ref, watch, defineEmits, defineProps, CSSProperties } from "vue";
import { Configuration } from "../context";
import { Form, FormItem, Divider, Space, Drawer, Checkbox, Button, Input, Select, SelectOption, RadioGroup, RadioButton } from "ant-design-vue";
import { MinusCircleOutlined, CheckCircleOutlined, CloseCircleOutlined, QuestionCircleOutlined } from "@ant-design/icons-vue";


const props = defineProps<{
    display: boolean;
    storeageKey?: string;
}>();

const emits = defineEmits<{
    (e: "load", data: Configuration): void;
    (e: "save", data: Configuration): void;
    (e: "cancel"): void;
    (e: "close"): void;
}>();


type ThreeState = "true" | "false" | "unset";

interface ConfigurationRaw {
    webrtc: {
        iceServers: {
            credential: string;
            url: [string, string];
            username: string;
            inUse: boolean;
        }[];
        bundlePolicy: "balanced" | "max-bundle" | "max-compat" | "unset";
        //certificates?: RTCCertificate[];
        //iceCandidatePoolSize?: number;
        iceTransportPolicy: "all" | "relay" | "unset";
        //rtcpMuxPolicy?: RTCRtcpMuxPolicy;
    },
    offer: {
        iceRestart: ThreeState;
        offerToReceiveAudio: ThreeState;
        offerToReceiveVideo: ThreeState;
    }
}

interface RTCICEServer {
    credential?: string;
    urls: string | string[];
    username?: string;
}

function string2bool(value: string): boolean | undefined {
    if (value === "true") {
        return true;
    } else if (value === "false") {
        return false;
    }
    return undefined;
}

function transferCfgICEServer(item: ConfigurationRaw["webrtc"]["iceServers"][0]): RTCICEServer {
    let value: RTCICEServer = {
        urls: item.url[0] + item.url[1]
    };
    if (item.credential) {
        value.credential = item.credential;
    }
    if (item.username) {
        value.username = item.username;
    }
    return value;
}

function transferCfgWebRTC(item: ConfigurationRaw["webrtc"]): Configuration["webrtc"] {
    let value: Configuration["webrtc"] = {};
    const inUsedICEServers = item.iceServers.filter((e) => e.inUse);
    if (inUsedICEServers) {
        value.iceServers = inUsedICEServers.map(transferCfgICEServer);
    }
    if (item.bundlePolicy !== "unset") {
        value.bundlePolicy = item.bundlePolicy;
    }
    if (item.iceTransportPolicy !== "unset") {
        value.iceTransportPolicy = item.iceTransportPolicy;
    }
    return value;
}

function transferCfgOffer(item: ConfigurationRaw["offer"]): Configuration["offer"] {
    let value: Configuration["offer"] = {};
    if (item.iceRestart !== "unset") {
        value.iceRestart = string2bool(item.iceRestart);
    }
    if (item.offerToReceiveAudio !== "unset") {
        value.offerToReceiveAudio = string2bool(item.offerToReceiveAudio);
    }
    if (item.offerToReceiveVideo !== "unset") {
        value.offerToReceiveVideo = string2bool(item.offerToReceiveVideo);
    }
    return value;
}

function transfer(cfg: ConfigurationRaw): Configuration {
    return {
        webrtc: transferCfgWebRTC(cfg.webrtc),
        offer: transferCfgOffer(cfg.offer)
    };
}

function loadFromStorage(key: string): ConfigurationRaw {
    let raw = localStorage.getItem(key);
    try {
        if (raw) {
            return JSON.parse(raw);
        }
    } catch (e) {
        console.error(e);
    }
    return {
        webrtc: {
            iceServers: [
                {
                    credential: "",
                    url: ["stun:", "stun.miwifi.com"],
                    username: "",
                    inUse: true
                }
            ],
            bundlePolicy: "unset",
            iceTransportPolicy: "unset",
        },
        offer: {
            iceRestart: "unset",
            offerToReceiveAudio: "true",
            offerToReceiveVideo: "unset",
        }
    };
}

function saveToStorage(key: string, data: ConfigurationRaw) {
    let raw = JSON.stringify(data);
    localStorage.setItem(key, raw);
}


const defaultKey = "webrtc-transfer-config";
const dataRaw = ref<ConfigurationRaw>(loadFromStorage(props.storeageKey || defaultKey));
{
    let data = transfer(dataRaw.value);
    emits("load", data);
}

function executeSave() {
    saveToStorage(props.storeageKey || defaultKey, dataRaw.value);
    let data = transfer(dataRaw.value);
    emits("save", data);
}

function executeCancel() {
    dataRaw.value = loadFromStorage(props.storeageKey || defaultKey);
    emits("cancel");
}

function executeClose() {
    emits("close");
}

function removeICEServer(item: ConfigurationRaw["webrtc"]["iceServers"][0]) {
    const index = dataRaw.value.webrtc.iceServers.indexOf(item);
    if (index !== -1) {
        dataRaw.value.webrtc.iceServers.splice(index, 1);
    }
};
function addICEServer() {
    dataRaw.value.webrtc.iceServers.push({
        credential: "",
        url: ["stun:", "stun.l.google.com"],
        username: "",
        inUse: true
    });
};

watch(
    () => props.display,
    (value, legacy) => {
        if (value) {
            dataRaw.value = loadFromStorage(props.storeageKey || defaultKey);
        }
    }
);

const formWrapperCol = {
    xs: {
        span: 24,
        offset: 0,
    },
    sm: {
        span: 20,
        offset: 4,
    },
};

const formWrapperColWithLabel = {
    xs: {
        span: 24,
    },
    sm: {
        span: 20,
    },
};

const formLabelColWithLabel = {
    xs: {
        span: 24,
    },
    sm: {
        span: 4,
    },
};   

const drawerBodyStyle: CSSProperties = {
    paddingBottom: "80px"
};

const drawerFooterStyle: CSSProperties = {
    textAlign: "right"
};

</script>

<template>
    <div class="config-panel">
        <Drawer title="Configuration" placement="right" v-bind:open="props.display" v-bind:body-style="drawerBodyStyle"
            v-bind:footer-style="drawerFooterStyle" width="50%" v-on:close="executeClose">
            <Form layout="horizontal" v-bind:model="dataRaw" name="config">
                <Divider>WebRTC</Divider>
                <div class="config-panel-webrtc-group">
                    <FormItem label="Bundle Policy" v-bind:name="['webrtc', 'bundlePolicy']">
                        <RadioGroup v-model:value="dataRaw.webrtc.bundlePolicy">
                            <RadioButton value="unset">
                                <QuestionCircleOutlined />
                            </RadioButton>
                            <RadioButton value="balanced">Balanced</RadioButton>
                            <RadioButton value="max-bundle">Max Bundle</RadioButton>
                            <RadioButton value="max-compat">Max Compatibility</RadioButton>
                        </RadioGroup>
                    </FormItem>
                    <FormItem label="ICE Transport Policy" v-bind:name="['webrtc', 'iceTransportPolicy']">
                        <RadioGroup v-model:value="dataRaw.webrtc.iceTransportPolicy">
                            <RadioButton value="unset">
                                <QuestionCircleOutlined />
                            </RadioButton>
                            <RadioButton value="all">All</RadioButton>
                            <RadioButton value="relay">Relay</RadioButton>
                        </RadioGroup>
                    </FormItem>
                    <Divider dashed orientation="left">ICE Servers</Divider>
                    <div>
                        <Space v-for="(iceServer, index) in dataRaw.webrtc.iceServers" v-bind:key="index"
                            style="display: flex; margin-bottom: 8px" align="baseline">
                            <FormItem v-bind:name="['webrtc', 'iceServers', index, 'inUse']">
                                <Checkbox v-model:checked="iceServer.inUse"></Checkbox>
                            </FormItem>
                            <FormItem v-bind:name="['webrtc', 'iceServers', index, 'url']">
                                <Input v-model:value="iceServer.url[1]">
                                <template #addonBefore>
                                    <Select v-model:value="iceServer.url[0]">
                                        <SelectOption value="stun:">stun:</SelectOption>
                                    </Select>
                                </template>
                                </Input>
                            </FormItem>
                            <FormItem v-bind:name="['webrtc', 'iceServers', index, 'username']">
                                <Input v-model:value="iceServer.username" placeholder="Username" />
                            </FormItem>
                            <FormItem v-bind:name="['webrtc', 'iceServers', index, 'credential']">
                                <Input v-model:value="iceServer.credential" placeholder="Credential" />
                            </FormItem>
                            <MinusCircleOutlined v-if="dataRaw.webrtc.iceServers.length > 1"
                                class="dynamic-delete-button" v-on:click="removeICEServer(iceServer);" />
                        </Space>
                        <FormItem>
                            <Button type="dashed" v-on:click="addICEServer">Add ICE Server</Button>
                        </FormItem>
                    </div>
                </div>
                <Divider>Offer</Divider>
                <div class="config-panel-offer-group">
                    <FormItem label="ICERestart" v-bind:name="['offer', 'iceRestart']">
                        <RadioGroup v-model:value="dataRaw.offer.iceRestart">
                            <RadioButton value="unset">
                                <QuestionCircleOutlined />
                            </RadioButton>
                            <RadioButton value="true">
                                <CheckCircleOutlined />
                            </RadioButton>
                            <RadioButton value="false">
                                <CloseCircleOutlined />
                            </RadioButton>
                        </RadioGroup>
                    </FormItem>
                    <FormItem label="Audio" v-bind:name="['offer', 'offerToReceiveAudio']">
                        <RadioGroup v-model:value="dataRaw.offer.offerToReceiveAudio">
                            <RadioButton value="unset">
                                <QuestionCircleOutlined />
                            </RadioButton>
                            <RadioButton value="true">
                                <CheckCircleOutlined />
                            </RadioButton>
                            <RadioButton value="false">
                                <CloseCircleOutlined />
                            </RadioButton>
                        </RadioGroup>
                    </FormItem>
                    <FormItem label="Video" v-bind:name="['offer', 'offerToReceiveVideo']">
                        <RadioGroup v-model:value="dataRaw.offer.offerToReceiveVideo">
                            <RadioButton value="unset">
                                <QuestionCircleOutlined />
                            </RadioButton>
                            <RadioButton value="true">
                                <CheckCircleOutlined />
                            </RadioButton>
                            <RadioButton value="false">
                                <CloseCircleOutlined />
                            </RadioButton>
                        </RadioGroup>
                    </FormItem>
                </div>
            </Form>
            <template #extra>
                <Space>
                    <Button v-on:click="executeCancel">Cancel</Button>
                    <Button type="primary" v-on:click="executeSave">Save</Button>
                </Space>
            </template>
        </Drawer>
    </div>
</template>

<style scoped></style>