import { v4 as uuidv4 } from "uuid";
import { WebRTCService } from "./webrtcsvc";

export interface WebRTCContextCallback {
    onConstruct: (peer: RTCPeerConnection) => void;
    onDestruct: (peer: RTCPeerConnection) => void;
    onError?: (peer: RTCPeerConnection, error: Error) => void;
}

type CallbackChainElement = {
    id: string;
    callback: WebRTCContextCallback;
    priority?: number;
    insert_index: number;
};

function compareCallbackChainElement(a: CallbackChainElement, b: CallbackChainElement): number {
    if (a.priority === undefined && b.priority === undefined) {
        return a.insert_index - b.insert_index;
    }
    if (a.priority === undefined) {
        return 1;
    }
    if (b.priority === undefined) {
        return -1;
    }
    const cmp = a.priority - b.priority;
    if (cmp === 0) {
        return a.insert_index - b.insert_index;
    }
    return cmp;
}

export class WebRTCContext {

    private callbacks: Map<string, CallbackChainElement>;
    private chain?: Array<CallbackChainElement>;
    private insert_index: number;
    private inner?: RTCPeerConnection;
    is_caller?: boolean;
    readonly uuid: string;

    constructor(uuid: string) {
        this.callbacks = new Map();
        this.chain = undefined;
        this.insert_index = 0;
        this.inner = undefined;
        this.is_caller = undefined;
        this.uuid = uuid;
    }

    create(config?: RTCConfiguration): RTCPeerConnection {
        this.destroy();
        const peer = new RTCPeerConnection(config);
        this.inner = peer;
        for (const element of this.buildChain()) {
            element.callback.onConstruct(peer);
        }
        return peer;
    }

    destroy() {
        if (this.inner) {
            for (const element of this.buildChain()) {
                element.callback.onDestruct(this.inner);
            }
            this.inner = undefined;
            this.is_caller = undefined;
        }
    }

    register(id: string, callback: WebRTCContextCallback, priority?: number, trigger?: boolean) {
        trigger = trigger || false;
        this.chain = undefined;
        const legacy = this.callbacks.get(id);
        this.callbacks.set(id, { id, callback, priority, insert_index: this.insert_index++ });
        if (trigger && this.inner) {
            if (legacy) {
                legacy.callback.onDestruct(this.inner);
            }
            callback.onConstruct(this.inner);
        }
    }

    unregister(id: string, trigger?: boolean) {
        this.chain = undefined;
        trigger = trigger || false;
        const legacy = this.callbacks.get(id);
        if (legacy) {
            this.callbacks.delete(id);
            if (trigger && this.inner) {
                legacy.callback.onDestruct(this.inner);
            }
        }
    }

    private buildChain(): Array<CallbackChainElement> {
        if (this.chain) {
            return this.chain;
        }
        const chain = Array.from(this.callbacks.values());
        chain.sort(compareCallbackChainElement);
        this.chain = chain;
        return chain;
    }
}




// =================================================================================================

/**
 * Configuration Definition
 */

export interface Configuration {

    webrtc: RTCConfiguration;

    offer: RTCOfferOptions;

    api: {

        download: "blob" | "filesystem";
    }
}



// =================================================================================================

export function generateUUID(): string {
    return uuidv4();
}

export interface Context {

    webrtc: WebRTCService;

    config: Configuration;
}

export const context: Context = {
    webrtc: new WebRTCService(
        generateUUID(),
    ),
    config: {
        webrtc: {

        },
        offer: {
        
        },
        api: {
            download: "blob",
        },
    },
};