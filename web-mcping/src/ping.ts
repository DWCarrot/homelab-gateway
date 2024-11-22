import { TextComponent, fromFormattedString } from "@createlumina/text-component";
import { MessageStream, TimeoutError, UnexpectedEOFError, WebSocketStream } from "./wsstream";

export interface Version {
    name: string;
    protocol: number;
}

export interface Player {
    name: string;
    id: string;
}

export interface Players {
    max: number;
    online: number;
    sample?: Player[];
}

export interface Status {
    version: Version;
    description?: TextComponent;    // require modifing from | string
    players?: Players;
    favicon?: string;     // require modifing from string/base64
    enforcesSecureChat?: boolean;
    previewsChat?: boolean;
}

export interface ServerListPingResult {
    host: string;
    port: number;
    status: Status;
    ping?: number;
}


export async function executePing(
    host: string, port?: number, forceUpdateDNS?: boolean, protocolVersion?: number, serverAddress?: string, timeout?: number
): Promise<ServerListPingResult> {
    port = port || 25565;
    let url = new URL(`/wsproxy/tcp/${host}/${port}`, location.href);
    url.protocol = "ws:";
    if (forceUpdateDNS) {
        url.searchParams.set("force_update", "1");
    }
    let ws = await WebSocketStream.connect(url.href, timeout);
    console.debug("[ping]", "connected to", url.href);

    let stream = new PacketStream(ws);
    let full = new Uint8Array(2048);
    let handshake = Packet.create(0x00, full.subarray(0, 1536))!;
    protocolVersion = protocolVersion || -1;
    handshake.writeVarInt(protocolVersion)
    serverAddress = serverAddress || host;
    handshake.writeString(serverAddress);
    handshake.writeUnsignedShort(port)
    const nextState = 1;
    handshake.writeVarInt(nextState)
    if (!stream.write(handshake)) {
        throw new Error(`send handshake failed: ${ws.state}`);
    }
    console.debug("[ping]", "send handshake");

    let request = Packet.create(0x00, full.subarray(1536, 1600))!;
    if (!stream.write(request)) {
        throw new Error(`send request failed: ${ws.state}`);
    }
    console.debug("[ping]", "send request");


    let response = await stream.read(timeout);
    console.debug("[ping]", "response", response?.id);
    if (!response) {
        throw new Error(`receive response failed: ${ws.state}`);
    }
    if (response.id !== 0x00) {
        throw new Error(`receive response failed: invalid id=${response.id}`);
    }
    let value = response.readString();
    if (!value) {
        throw new Error("parse response failed");
    }

    let [status, ping] = await Promise.all([modifyStatus(JSON.parse(value)), getPing(ws, stream, full, timeout)]);
    let result ={ status, ping, host, port } as ServerListPingResult;
    console.log(result);
    return result;
}

async function getPing(ws: WebSocketStream, stream: PacketStream, full: Uint8Array, timeout?: number): Promise<number | undefined> {

    let pingReuest = Packet.create(0x01, full.subarray(1600, 1800))!;
    let pingStart = Date.now();
    pingReuest.writeLong(BigInt(pingStart))
    if (!stream.write(pingReuest)) {
        throw new Error(`send ping request failed: ${ws.state}`);
    }
    console.debug("[ping]", "send ping request");

    try {
        let pingResponse = await stream.read(timeout);
        if (pingResponse && pingResponse.id === 0x01) {
            console.debug("[ping]", "response ping", pingResponse.id);
            let pingEnd = Date.now();
            return pingEnd - pingStart;
        }
    } catch (e) {
        if (e instanceof TimeoutError) {
            console.error("[ping]", "ping timeout");
        } else if (e instanceof UnexpectedEOFError) {
            console.error("[ping]", "ping unexpected eof");
        } else {
            throw e;
        }
    }
    return undefined;
}

function modifyStatus(data: any): Promise<Status> {
    return new Promise(function (resolve, reject) {
        let wait = false;
        const description = data.description;
        if (description) {
            if (typeof description === "string") {
                try {
                    data.description = fromFormattedString(description);
                } catch (e) {
                    reject(e);
                }
            }
        }
        // const favicon = data.favicon;
        // if (favicon) {
        //     if (typeof favicon === "string") {
        //         let img = new Image();
        //         img.src = favicon;
        //         img.onload = function () {
        //             let canvas = document.createElement('canvas');
        //             let ctx = canvas.getContext('2d');
        //             if (ctx) {
        //                 canvas.width = img.width;
        //                 canvas.height = img.height;
        //                 ctx.drawImage(img, 0, 0);
        //                 data.favicon = ctx.getImageData(0, 0, canvas.width, canvas.height);
        //                 resolve(data as Status);
        //             } else {
        //                 reject("Failed to get canvas context");
        //             }
        //         }
        //         wait = true;
        //     }
        // }
        const sample = data.players?.sample;
        if (sample) {
            if(sample.length === 0) {
                data.players.sample = undefined;
            }
        }
        if (!wait) {
            resolve(data as Status);
        }
    });
}


export class Packet {

    static readonly SEGMENT_BITS = 0x7F;
    static readonly INV_SEGMENT_BITS = ~Packet.SEGMENT_BITS;
    static readonly CONTINUE_BIT = 0x80;
    static readonly PACKET_LEN_RESERVE = 8;

    private view: DataView;
    private executePing: number;
    private writeIndex: number;
    private _id?: number;
    private _wholeBytes?: number;

    static parse(data: Uint8Array): Packet | undefined {
        let view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        let packet = new Packet(view, 0, view.byteLength);
        let packetLen = packet.readVarInt();
        if (packetLen === undefined || packet.readable < packetLen) {
            return undefined;
        }
        packet.writeIndex = packet.executePing + packetLen;
        packet._wholeBytes = packet.writeIndex;
        packet._id = packet.readByte();
        if (packet._id === undefined) {
            return undefined;
        }
        return packet;
    }

    static create(id: number, buffer: Uint8Array): Packet | undefined {
        let view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        let packet = new Packet(view, Packet.PACKET_LEN_RESERVE, Packet.PACKET_LEN_RESERVE);
        packet._id = id;
        if (!packet.writeByte(id)) {
            return undefined;
        }
        return packet;
    }

    private constructor(view: DataView, readIndex: number, writeIndex: number) {
        this.view = view;
        this.executePing = readIndex;
        this.writeIndex = writeIndex;
    }

    get readable(): number {
        return this.writeIndex - this.executePing;
    }

    get writable(): number {
        return this.view.byteLength - this.writeIndex;
    }

    get id(): number {
        return this._id!;
    }

    get wholeBytes(): number | undefined {
        return this._wholeBytes;
    }

    writeByte(value: number): boolean {
        if (this.writable >= 1) {
            this.view.setUint8(this.writeIndex, value);
            this.writeIndex += 1;
            return true;
        }
        return false;
    }

    readByte(): number | undefined {
        let result;
        if (this.readable >= 1) {
            result = this.view.getUint8(this.executePing);
            this.executePing += 1;
        }
        return result;
    }

    writeUnsignedShort(value: number): boolean {
        if (this.writable >= 2) {
            this.view.setUint16(this.writeIndex, value, false);
            this.writeIndex += 2;
            return true;
        }
        return false;
    }

    readUnsignedShort(): number | undefined {
        let result;
        if (this.readable >= 2) {
            result = this.view.getUint16(this.executePing, false);
            this.executePing += 2;
        }
        return result;
    }

    writeLong(value: bigint): boolean {
        if (this.writable >= 8) {
            this.view.setBigInt64(this.writeIndex, value, false);
            this.writeIndex += 8;
            return true;
        }
        return false;
    }

    readLong(): bigint | undefined {
        let result;
        if (this.readable >= 8) {
            result = this.view.getBigInt64(this.executePing, false);
            this.executePing += 8;
        }
        return result;
    }

    writeVarInt(value: number): boolean {
        value = value & 0xFFFFFFFF;
        let index = this.writeIndex;
        while (true) {
            if ((value & Packet.INV_SEGMENT_BITS) === 0) {
                if (!this.writeByte(value)) {
                    this.writeIndex = index;
                    return false;
                }
                return true;
            }
            if (!this.writeByte((value & Packet.SEGMENT_BITS) | Packet.CONTINUE_BIT)) {
                this.writeIndex = index;
                return false;
            }
            value >>>= 7;
        }
    }

    readVarInt(): number | undefined {
        let index = this.executePing;
        let result = 0;
        let position = 0;
        while (true) {
            let value = this.readByte();
            if (value === undefined) {
                this.executePing = index;
                return undefined;
            }
            result |= ((value & Packet.SEGMENT_BITS) << position);
            if ((value & Packet.CONTINUE_BIT) === 0) {
                break;
            }
            position += 7;
            if (position > 35) {
                this.executePing = index;
                throw new Error('VarInt too big');
            }
        }
        return result;
    }

    writeString(value: string): boolean {
        let index = this.writeIndex;
        let encoder = new TextEncoder();
        let raw = encoder.encode(value);
        if (!this.writeVarInt(raw.byteLength)) {
            this.writeIndex = index;
            return false;
        }
        if (this.writable < raw.byteLength) {
            this.writeIndex = index;
            return false;
        }
        let view = new Uint8Array(this.view.buffer, this.writeIndex);
        view.set(raw);
        this.writeIndex += raw.byteLength;
        return true;
    }

    readString(): string | undefined {
        let index = this.executePing;
        let length = this.readVarInt();
        if (length === undefined) {
            return undefined;
        }
        if (this.readable < length) {
            this.executePing = index;
            return undefined;
        }
        let raw = this.view.buffer.slice(this.executePing, this.executePing + length);
        this.executePing += length;
        let decoder = new TextDecoder('utf-8');
        return decoder.decode(raw);
    }

    dump(): Uint8Array | undefined {
        if (this.readable > 0 && this.view.getUint8(this.executePing) === (this._id!)) {
            let packetLen = this.readable;
            let varLen = Math.ceil(Math.ceil(Math.log2(packetLen + 1)) / 7) << 0x0;
            let writeIndex = this.writeIndex;
            let start = Packet.PACKET_LEN_RESERVE - varLen
            this.writeIndex = start;
            this.writeVarInt(packetLen);
            this.writeIndex = writeIndex;
            let end = this.writeIndex;
            start = this.view.byteOffset + start;
            end = this.view.byteOffset + end;
            return new Uint8Array(this.view.buffer, start, end - start);
        }
        return undefined;
    }
}


export class PacketStream extends MessageStream<Packet> {

    constructor(ws: WebSocketStream) {
        super(ws);
    }

    protected override encode(message: Packet): Uint8Array {
        let data = message.dump();
        if (data) {
            return data;
        }
        throw new Error('Invalid packet');
    }

    protected override decode(data: Uint8Array, outList: Packet[]): number {
        let packet = Packet.parse(data);
        if (packet) {
            outList.push(packet);
            return packet.wholeBytes!;
        }
        return 0;
    }

    override write(data: Packet | Packet[]): boolean {
        if (this.stream.state === WebSocket.OPEN) {
            if (data instanceof Array) {
                for (let packet of data) {
                    let buffer = this.encode(packet);
                    if (buffer === undefined) {
                        throw new Error('Invalid packet');
                    }
                    this.stream.write(buffer);
                }
                return true;
            } else {
                let buffer = this.encode(data);
                if (buffer === undefined) {
                    throw new Error('Invalid packet');
                }
                this.stream.write(buffer);
                return true;
            }
        } else {
            return false;
        }
    }
}