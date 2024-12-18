
/**
 * Connection information
 */
export interface ConnectionInfo {

    readonly localId: string;

    readonly remoteId: string;

    readonly channelId: string;

    readonly primary: boolean;   // true: is primary peer, false: is secondary peer
}


/**
 *  Negotiation interface
 */
export interface INegotiator {

    /**
     * 
     * @param conn target RTCPeerConnection. garantueed to be ready for connecting
     * @param options RTCOfferOptions
     */
    negotiate(conn: RTCPeerConnection, options?: RTCOfferOptions): Promise<ConnectionInfo>;
}


export interface Dual<T> {
    readonly rx?: T;
    readonly tx: T;
}

let handleCounter = 0;

interface PriorityLifeCycleElement<T> {
    onConstruct: (value: T) => void;
    onDestruct: (value: T) => void;
    priority?: number;
    handle: number;
}

function spawn<T>(action: (arg: T) => void, arg: T): Promise<void> {
    return new Promise((resolve, reject) => {
        try {
            action(arg);
            resolve();
        } catch (e) {
            reject(e);
        }
    });

}

function addPriorityLifeCycleElement<T>(
    list: Array<PriorityLifeCycleElement<T>>,
    onConstruct: (value: T) => void,
    onDestruct: (value: T) => void,
    priority?: number,
    data?: T
): number {
    const element: PriorityLifeCycleElement<T> = {
        onConstruct,
        onDestruct,
        priority,
        handle: ++handleCounter
    };
    let index = 0;
    if (list.length === 0 || element.priority === undefined) {
        index = list.length;
        list.push(element);
    } else {
        index = list.findIndex((e) => {
            if (e.priority === undefined) {
                return true;
            }
            return element.priority! < e.priority!;
        });
        if (index < 0) {
            index = list.length;
        }
        list.splice(index, 0, element);
    }
    if (data !== undefined) {
        spawn(element.onConstruct, data);
    }
    return element.handle;
}

function removePriorityLifeCycleElement<T>(
    list: Array<PriorityLifeCycleElement<T>>,
    handle: number,
    data?: T
): boolean {
    const index = list.findIndex((e) => e.handle === handle);
    if (index >= 0) {
        const removed = list.splice(index, 1);
        if (data !== undefined) {
            const element = removed[0];
            spawn(element.onDestruct, data);
        }
        return true;
    }
    return false;
}

function triggerConstructPriorityLifeCycleElement<T>(
    list: Array<PriorityLifeCycleElement<T>>,
    data: T
) {
    for (const element of list) {
        spawn(element.onConstruct, data);
    }
}

function triggerDestructPriorityLifeCycleElement<T>(
    list: Array<PriorityLifeCycleElement<T>>,
    data: T
) {
    for (const element of list) {
        spawn(element.onDestruct, data);
    }
}


interface PeerConnectionCallbacks {
    onPeerConnectionStateChange: (ev: Event) => void;
    onDataChannel: (ev: RTCDataChannelEvent) => void;
}


interface DataChannelElement {
    createOptions?: RTCDataChannelInit;
    tx?: RTCDataChannel;
    rx?: RTCDataChannel;
    result?: Dual<RTCDataChannel>;
    handles: Array<PriorityLifeCycleElement<Dual<RTCDataChannel>>>;
}


export type WebRTCServiceStatus = RTCPeerConnectionState | "closing" | "idle";


/**
 * WebRTC service interface
 */
export class WebRTCService {

    private _uuid: string;
    private _info?: ConnectionInfo;
    private _conn?: RTCPeerConnection;
    private _connCallbacks?: PeerConnectionCallbacks;
    private _connHandles: Array<PriorityLifeCycleElement<RTCPeerConnection>>;
    private _dataChannels: Map<string, DataChannelElement>;
    private _handleDataChannels: number;
    private _callbacksStatusChange: Array<(status: WebRTCServiceStatus) => void>;

    get uuid(): string {
        return this._uuid;
    }

    get status(): WebRTCServiceStatus {
        return this._conn ? this._conn.connectionState : "idle";
    }

    get info(): ConnectionInfo | undefined {
        return this._info;
    }

    constructor(uuid: string) {
        this._uuid = uuid;
        this._conn = undefined;
        this._connCallbacks = undefined;
        this._connHandles = [];
        this._dataChannels = new Map<string, DataChannelElement>();
        this._handleDataChannels = this.registerPeerConnection(this._initDataChannels.bind(this), this._dropDataChannels.bind(this));
        this._callbacksStatusChange = [];
    }

    onStatusChange(callback: (status: WebRTCServiceStatus) => void) {
        this._callbacksStatusChange.push(callback);
    }

    offStatusChange(callback: (status: WebRTCServiceStatus) => void) {
        const index = this._callbacksStatusChange.indexOf(callback);
        if (index >= 0) {
            this._callbacksStatusChange.splice(index, 1);
        }
    }

    /**
     * register a RTCPeerConnection handle
     * @param onConstruct callback when the connection is created (not connected)
     * @param onDestruct callback when the connection is dropped (not closed)
     * @param priority priority of the connection
     * @returns handle of the callback for unregistering; 0 if failed
     */
    registerPeerConnection(onConstruct: (value: RTCPeerConnection) => void, onDestruct: (value: RTCPeerConnection) => void, priority?: number,): number {
        return addPriorityLifeCycleElement(this._connHandles, onConstruct, onDestruct, priority, this._conn);
    }

    /**
     * unregister a RTCPeerConnection handle
     * @param handle handle of the connection
     * @returns true if the handle is found and removed
     */
    unregisterPeerConnection(handle: number): boolean {
        if (handle === 0) {
            return false;
        }
        return removePriorityLifeCycleElement(this._connHandles, handle, this._conn);
    }

    /**
     * register a data channel handle
     * @param label label of the channel
     * @param priority priority of the channel
     * @returns handle of the callback for unregistering; 0 if failed
     */
    registerDataChannel(label: string, onConstruct: (value: Dual<RTCDataChannel>) => void, onDestruct: (value: Dual<RTCDataChannel>) => void, priority?: number, createOptions?: RTCDataChannelInit): number {
        let element = this._dataChannels.get(label);
        if (!element) {
            element = {
                handles: [],
                createOptions,
            };
            if (this._conn && this._conn.connectionState === "new") {
                element.tx = this._conn.createDataChannel(this.generateDataChannelLabel(label));
            }
            this._dataChannels.set(label, element);
        }
        return addPriorityLifeCycleElement(element.handles, onConstruct, onDestruct, priority, element.result);
    }

    /**
     * unregister a data channel handle
     * @param label label of the channel
     * @param handle handle of the channel
     * @returns true if the handle is found and removed
     */
    unregisterDataChannel(label: string, handle: number): boolean {
        const element = this._dataChannels.get(label);
        if (element) {
            return removePriorityLifeCycleElement(element.handles, handle, element.result);
        }
        return false;
    }

    create(config?: RTCConfiguration): RTCPeerConnection | undefined {
        if (!this._conn) {
            const conn = this._conn = new RTCPeerConnection(config);
            this._initConn(conn);
            this._emitStatusChange(conn.connectionState);
            return conn;
        }
        return undefined;
    }

    connect(negotiation: INegotiator, options?: RTCOfferOptions): Promise<ConnectionInfo> {
        if (this._conn && this._conn.connectionState === "new") {
            return negotiation.negotiate(this._conn, options)
                .then((info) => {
                    this._info = info;
                    return info;
                });
        }
        return Promise.reject(new Error("already connected"));
    }

    close() {
        if (this._conn) {
            this._emitStatusChange("closing");
            this._conn.close();
            this._emitStatusChange(this._conn.connectionState);
        }
    }

    reset() {
        if (this._conn) {
            this._conn.close();
            this._dropConn(this._conn);
            this._conn = undefined;
            this._emitStatusChange("idle");
        }
    }

    private _emitStatusChange(status: WebRTCServiceStatus) {
        for (const callback of this._callbacksStatusChange) {
            callback(status);
        }
    }

    private _initConn(conn: RTCPeerConnection) {
        const callbacks = this._connCallbacks = {
            onPeerConnectionStateChange: this._onPeerConnectionStateChange.bind(this),
            onDataChannel: this._onDataChannel.bind(this),
        };
        conn.addEventListener("connectionstatechange", callbacks.onPeerConnectionStateChange);
        conn.addEventListener("datachannel", callbacks.onDataChannel);
        triggerConstructPriorityLifeCycleElement(this._connHandles, conn);
    }

    private _dropConn(conn: RTCPeerConnection) {
        const callbacks = this._connCallbacks;
        if (callbacks) {
            triggerDestructPriorityLifeCycleElement(this._connHandles, conn);
            conn.removeEventListener("datachannel", callbacks.onDataChannel);
            conn.removeEventListener("connectionstatechange", callbacks.onPeerConnectionStateChange);
            this._connCallbacks = undefined;
        }
    }

    private _initDataChannels(conn: RTCPeerConnection) {
        for (const [label, element] of this._dataChannels) {
            element.tx = conn.createDataChannel(this.generateDataChannelLabel(label));
        }
    }

    private _dropDataChannels(conn: RTCPeerConnection) {
        for (const element of this._dataChannels.values()) {
            if (element.result) {
                triggerDestructPriorityLifeCycleElement(element.handles, element.result);
            }
            element.result = undefined;
            element.rx = undefined;
            element.tx = undefined;
        }
    }

    private _onPeerConnectionStateChange(event: Event) {
        const conn = event.target as RTCPeerConnection;
        console.debug(`WebRTCService[${this._uuid}] connection state: ${conn.connectionState}`);
        this._emitStatusChange(conn.connectionState);
    }

    private _onDataChannel(event: RTCDataChannelEvent) {
        const channel = event.channel;
        console.debug(`WebRTCService[${this._uuid}] receive data channel: ${channel.label}`);
        const [label, uuid] = this.parseDataChannelLabel(channel.label);
        const element = this._dataChannels.get(label);
        if (element) {
            if (element.rx) {
                console.warn(`WebRTCService[${this._uuid}] data channel ${label} already exists: ${element.rx.label}`);
                return;
            }
            element.rx = channel;
            element.result = { rx: channel, tx: element.tx! };
            triggerConstructPriorityLifeCycleElement(element.handles, element.result);
        }
    }

    generateDataChannelLabel(label: string): string {
        return `${label}|${this._uuid}`;
    }

    parseDataChannelLabel(labelFull: string): [string, string] {
        const index = labelFull.lastIndexOf("|");
        if (index < 0) {
            return [labelFull, ""];
        }
        return [labelFull.substring(0, index), labelFull.substring(index + 1)];
    }
}



interface Protocol {
    id?: string;
    offer?: string;
    answer?: string;
    icecandidates?: RTCIceCandidateInit[];
    message?: string | object;
}

interface ProtocolOffer extends Protocol {
    id: string;
    offer: string;
    icecandidates: RTCIceCandidateInit[];
}

interface ProtocolAnswer extends Protocol {
    id: string;
    answer: string;
    icecandidates: RTCIceCandidateInit[];
}

type NegotiationCallback = {
    onPeerConnectionStateChange: (ev: Event) => void;
    onICEConnectionStateChange: (ev: Event) => void;
    onICEGatheringStateChange: (ev: Event) => void;
    onICECandidate: (ev: RTCPeerConnectionIceEvent) => void;
};

export class HTTPError extends Error {
    public readonly status: number;
    public readonly statusText: string;
    public readonly reason?: string;
    constructor(status: number, statusText: string, reason?: string) {
        super(reason ? `HTTPError ${status} ${statusText}: ${reason}` : `HTTPError ${status} ${statusText}`);
        this.status = status;
        this.statusText = statusText;
        this.reason = reason;
    }
}

export interface SignalingOptions {
    server?: string;
    endpoint?: (channel: string, id: string) => string;
    timeout?: number;
}

export class DemoNegotiator implements INegotiator {

    private _localId: string;
    private _remoteId: string;
    private _channelId: string;
    private _primary: boolean;
    private _options?: SignalingOptions;

    private _icecandidates?: RTCIceCandidateInit[];
    private onCompleted: () => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private onFailed: (e: any) => void;


    //onCompleted?: () => void;
    //onFailed?: (e: any) => void;

    get localId(): string {
        return this._localId;
    }

    get remoteId(): string {
        return this._remoteId;
    }

    get channelId(): string {
        return this._channelId;
    }

    get primary(): boolean {
        return this._primary;
    }

    constructor(localId: string, channelId: string, options?: SignalingOptions) {
        this._localId = localId;
        this._remoteId = "";
        this._channelId = channelId;
        this._primary = true;
        this._options = options;
        this._icecandidates = undefined;
        this.onCompleted = () => { console.debug("Negotiation::onCompleted"); };
        this.onFailed = (e) => { console.debug("Negotiation::onFailed", e); };
    }

    negotiate(conn: RTCPeerConnection, options?: RTCOfferOptions): Promise<ConnectionInfo> {
        const callbacks = this.bind(conn);
        return new Promise((resolve, reject) => {
            this.onCompleted = () => {
                this.unbind(conn, callbacks);
                resolve({
                    localId: this._localId,
                    remoteId: this._remoteId,
                    channelId: this._channelId,
                    primary: this._primary,
                });
            };
            this.onFailed = (e) => {
                this.unbind(conn, callbacks);
                reject(e);
            };
            this.makeOffer(conn, options);
        });
    }

    async request(description: RTCSessionDescriptionInit, icecandidates: RTCIceCandidateInit[], message?: string | object): Promise<Protocol> {
        let base = location.href;
        let path = `/signaling/${this._channelId}/${this._localId}`;
        if (this._options) {
            if (this._options.endpoint !== undefined) {
                path = this._options.endpoint(this._channelId, this._localId);
            }
            if (this._options.server !== undefined) {
                base = this._options.server;
            }
        }
        const url = new URL(path, base ? base : undefined);
        const timeout = this._options?.timeout;
        if (timeout) {
            url.searchParams.append("timeout", timeout.toString());
        }
        const reqData: Protocol = {
            id: this._localId,
            icecandidates,
        };
        switch (description.type) {
            case "offer":
                reqData.offer = description.sdp;
                break;
            case "answer":
                reqData.answer = description.sdp;
                break;
        }
        if (message !== undefined) {
            reqData.message = message;
        }
        const resp = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(reqData),
        });
        if (!resp.ok) {
            let httpError: Error;
            try {
                const reason = await resp.text();
                httpError = new HTTPError(resp.status, resp.statusText, reason);
            } catch (e) {
                httpError = new HTTPError(resp.status, resp.statusText);
            }
            throw httpError;
        }
        const respData = await resp.json() as Protocol;
        if ("offer" in respData || "answer" in respData) {
            this._remoteId = respData.id!;
        }
        return respData;
    };


    private async makeOffer(conn: RTCPeerConnection, options?: RTCOfferOptions) {
        const offer = await conn.createOffer(options);
        await conn.setLocalDescription(offer);
        console.info("Negotiation setLocalDescription offer");
    }

    private async exchangePeerInfo(conn: RTCPeerConnection, description: RTCSessionDescriptionInit, icecandidates: RTCIceCandidateInit[]) {
        console.debug("Negotiation::exchangePeerInfo send", description.type);
        // icecandidates = icecandidates.filter((c) => c.sdpMLineIndex === 0);
        const ret = await this.request(description, icecandidates);
        if ("offer" in ret) {
            console.debug("Negotiation::exchangePeerInfo receive offer; rollback and answer");
            const ret0 = ret as ProtocolOffer;
            await conn.setLocalDescription({ type: "rollback" });
            console.info("Negotiation rollbackLocalDescription");
            await conn.setRemoteDescription({ type: "offer", sdp: ret0.offer });
            console.info("Negotiation setRemoteDescription offer");
            const answer = await conn.createAnswer();
            await conn.setLocalDescription(answer);
            console.info("Negotiation setLocalDescription answer");
            for (const candidate of ret0.icecandidates) {
                await conn.addIceCandidate(candidate);
            }
            console.info("Negotiation addIceCandidate", ret0.icecandidates.length);
            this._primary = false;
        } else if ("answer" in ret) {
            console.debug("Negotiation::exchangePeerInfo receive answer");
            const ret1 = ret as ProtocolAnswer;
            await conn.setRemoteDescription({ type: "answer", sdp: ret1.answer });
            console.info("Negotiation setRemoteDescription answer");
            for (const candidate of ret1.icecandidates) {
                await conn.addIceCandidate(candidate);
            }
            console.info("Negotiation addIceCandidate", ret1.icecandidates.length);
            this._primary = true;
        }
    }

    private onICEGatheringStateChange(ev: Event) {
        const conn = ev.target as RTCPeerConnection;
        switch (conn.iceGatheringState) {
            case "gathering":
                console.debug("Negotiation::onICEGatheringStateChange gathering");
                this._icecandidates = [];
                break;
            case "complete":
                console.debug("Negotiation::onICEGatheringStateChange complete", this._icecandidates!.length);
                {
                    const description = conn.localDescription!;
                    const icecandidates = this._icecandidates!;
                    this._icecandidates = undefined;
                    this.exchangePeerInfo(conn, description, icecandidates).catch(this.onFailed.bind(this));
                }
                break;
        }
    }

    private onICECandidate(ev: RTCPeerConnectionIceEvent) {
        const icecandidates = this._icecandidates;
        if (icecandidates !== undefined) {
            const candidate = ev.candidate;
            if (candidate) {
                icecandidates.push(candidate.toJSON());
                console.debug("Negotiation::onICECandidate add", candidate);
            }
        }
    }

    private onICEConnectionStateChange(ev: Event) {

    }

    private onPeerConnectionStateChange(ev: Event) {
        const conn = ev.target as RTCPeerConnection;
        switch (conn.connectionState) {
            case "new":
                break;
            case "connecting":
                break;
            case "connected":
                this.onCompleted();
                break;
            case "disconnected":
                this.onFailed(new Error("disconnected"));
                break;
            case "failed":
                this.onFailed(new Error("failed"));
                break;
        }
    }

    bind(conn: RTCPeerConnection): NegotiationCallback {
        const callbacks: NegotiationCallback = {
            onPeerConnectionStateChange: this.onPeerConnectionStateChange.bind(this),
            onICEConnectionStateChange: this.onICEConnectionStateChange.bind(this),
            onICEGatheringStateChange: this.onICEGatheringStateChange.bind(this),
            onICECandidate: this.onICECandidate.bind(this),
        };
        conn.addEventListener("connectionstatechange", callbacks.onPeerConnectionStateChange);
        conn.addEventListener("iceconnectionstatechange", callbacks.onICEConnectionStateChange);
        conn.addEventListener("icegatheringstatechange", callbacks.onICEGatheringStateChange);
        conn.addEventListener("icecandidate", callbacks.onICECandidate);
        return callbacks;
    }

    unbind(conn: RTCPeerConnection, callbacks: NegotiationCallback) {
        conn.removeEventListener("connectionstatechange", callbacks.onPeerConnectionStateChange);
        conn.removeEventListener("iceconnectionstatechange", callbacks.onICEConnectionStateChange);
        conn.removeEventListener("icegatheringstatechange", callbacks.onICEGatheringStateChange);
        conn.removeEventListener("icecandidate", callbacks.onICECandidate);
    }
}
