export interface Protocol {
    id?: string;
    offer?: string;
    answer?: string;
    icecandidates?: RTCIceCandidateInit[];
    message?: any;
}

export interface ProtocolOffer extends Protocol {
    id: string;
    offer: string;
    icecandidates: RTCIceCandidateInit[];
}

export interface ProtocolAnswer extends Protocol {
    id: string;
    answer: string;
    icecandidates: RTCIceCandidateInit[];
}


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


export class Signaling {

    public readonly channel: string;
    public readonly id: string;
    public get remote_id(): string {
        return this._remote_id || "";
    }
    private _remote_id?: string;
    private _options?: SignalingOptions;

    constructor(channel: string, id: string, options?: SignalingOptions) {
        this.channel = channel;
        this.id = id;
        this._options = options;
    }

    request(description: RTCSessionDescriptionInit, icecandidates: RTCIceCandidateInit[], message?: any): Promise<Protocol> {
        let base = location.href;
        let path = `/signaling/${this.channel}/${this.id}`;
        if (this._options) {
            if (this._options.endpoint !== undefined) {
                path = this._options.endpoint(this.channel, this.id);
            }
            if (this._options.server !== undefined) {
                base = this._options.server;
            }
        }
        const url = new URL(path, base ? base : undefined);
        let timeout = this._options?.timeout;
        if (timeout) {
            url.searchParams.append("timeout", timeout.toString());
        }
        const data: Protocol = {
            id: this.id,
            icecandidates,
        };
        switch (description.type) {
            case "offer":
                data.offer = description.sdp;
                break;
            case "answer":
                data.answer = description.sdp;
                break;
        }
        if (message !== undefined) {
            data.message = message;
        }
        return fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(data),
        })
            .then((resp) => {
                if (!resp.ok) {
                    return resp.text()
                        .then((reason) => {
                            throw new HTTPError(resp.status, resp.statusText, reason);
                        });
                } else {
                    return resp.json();
                }
            })
            .then((json_obj) => {
                let data = json_obj as Protocol;
                if ("offer" in data || "answer" in data) {
                    this._remote_id = data.id!;
                }
                return data;
            });
    }

}


interface NegotiationCallback {
    onPeerConnectionStateChange: (ev: Event) => void;
    onICEConnectionStateChange: (ev: Event) => void;
    onICEGatheringStateChange: (ev: Event) => void;
    onICECandidate: (ev: RTCPeerConnectionIceEvent) => void;
}

class Negotiation {

    private peer_conn: RTCPeerConnection;
    private signaling: Signaling;
    private icecandidates?: RTCIceCandidateInit[];

    onCompleted?: () => void;
    onFailed?: (e: any) => void;

    constructor(peer_conn: RTCPeerConnection, signaling: Signaling) {
        this.peer_conn = peer_conn;
        this.signaling = signaling;
    }

    async makeOffer(options?: RTCOfferOptions) {
        const offer = await this.peer_conn.createOffer(options);
        await this.peer_conn.setLocalDescription(offer);
        console.info("Negotiation setLocalDescription offer");
    }

    private async exchangePeerInfo(description: RTCSessionDescriptionInit, icecandidates: RTCIceCandidateInit[]) {
        try {
            console.debug("Negotiation::exchangePeerInfo send", description.type);
            let ret = await this.signaling.request(description, icecandidates);
            if ("offer" in ret) {
                console.debug("Negotiation::exchangePeerInfo receive offer; rollback and answer");
                let ret0 = ret as ProtocolOffer;
                await this.peer_conn.setLocalDescription({ type: "rollback" });
                console.info("Negotiation rollbackLocalDescription");
                await this.peer_conn.setRemoteDescription({ type: "offer", sdp: ret0.offer });
                console.info("Negotiation setRemoteDescription offer");
                let answer = await this.peer_conn.createAnswer();
                await this.peer_conn.setLocalDescription(answer);
                console.info("Negotiation setLocalDescription answer");
                for (const candidate of ret0.icecandidates) {
                    await this.peer_conn.addIceCandidate(candidate);
                }
                console.info("Negotiation addIceCandidate", ret0.icecandidates.length);
            } else if ("answer" in ret) {
                console.debug("Negotiation::exchangePeerInfo receive answer");
                let ret1 = ret as ProtocolAnswer;
                await this.peer_conn.setRemoteDescription({ type: "answer", sdp: ret1.answer });
                console.info("Negotiation setRemoteDescription answer");
                for (const candidate of ret1.icecandidates) {
                    await this.peer_conn.addIceCandidate(candidate);
                }
                console.info("Negotiation addIceCandidate", ret1.icecandidates.length);
            }
        } catch (e) {
            if (this.onFailed) {
                this.onFailed(e);
            }
        }
    }

    private onICEGatheringStateChange(ev: Event) {
        const peer_conn = this.peer_conn;
        switch (peer_conn.iceGatheringState) {
            case "gathering":
                console.debug("Negotiation::onICEGatheringStateChange gathering");
                this.icecandidates = [];
                break;
            case "complete":
                console.debug("Negotiation::onICEGatheringStateChange complete", this.icecandidates?.length);
                const description = peer_conn.localDescription!;
                const icecandidates = this.icecandidates!;
                this.icecandidates = undefined;
                this.exchangePeerInfo(description, icecandidates);
                break;
        }
    }

    private onICECandidate(ev: RTCPeerConnectionIceEvent) {
        const icecandidates = this.icecandidates;
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
        switch (this.peer_conn.connectionState) {
            case "new":
                break;
            case "connecting":
                break;
            case "connected":
                if (this.onCompleted) {
                    this.onCompleted();
                }
                break;
            case "disconnected":
                if (this.onFailed) {
                    this.onFailed(new Error("disconnected"));
                }
                break;
            case "failed":
                if (this.onFailed) {
                    this.onFailed(new Error("failed"));
                }
                break;
        }
    }

    bind(): NegotiationCallback {
        let callbacks: NegotiationCallback = {
            onPeerConnectionStateChange: this.onPeerConnectionStateChange.bind(this),
            onICEConnectionStateChange: this.onICEConnectionStateChange.bind(this),
            onICEGatheringStateChange: this.onICEGatheringStateChange.bind(this),
            onICECandidate: this.onICECandidate.bind(this),
        };
        this.peer_conn.addEventListener("connectionstatechange", callbacks.onPeerConnectionStateChange);
        this.peer_conn.addEventListener("iceconnectionstatechange", callbacks.onICEConnectionStateChange);
        this.peer_conn.addEventListener("icegatheringstatechange", callbacks.onICEGatheringStateChange);
        this.peer_conn.addEventListener("icecandidate", callbacks.onICECandidate);
        return callbacks;
    }

    unbind(callbacks: NegotiationCallback) {
        this.peer_conn.removeEventListener("connectionstatechange", callbacks.onPeerConnectionStateChange);
        this.peer_conn.removeEventListener("iceconnectionstatechange", callbacks.onICEConnectionStateChange);
        this.peer_conn.removeEventListener("icegatheringstatechange", callbacks.onICEGatheringStateChange);
        this.peer_conn.removeEventListener("icecandidate", callbacks.onICECandidate);
    }
}


export function negotiate(peer_conn: RTCPeerConnection, signaling: Signaling, offer_options?: RTCOfferOptions): Promise<void> {
    let negotiation = new Negotiation(peer_conn, signaling);
    let callbacks = negotiation.bind();
    return new Promise((resolve, reject) => {
        negotiation.onCompleted = () => {
            negotiation.unbind(callbacks);
            resolve();
        };
        negotiation.onFailed = (e) => {
            negotiation.unbind(callbacks);
            reject(e);
        };
        negotiation.makeOffer(offer_options);
    });
}