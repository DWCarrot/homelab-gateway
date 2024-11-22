
/**
 * Rust-like Stream
 */
export interface Stream<T> {

    read(timeout?: number): Promise<T | undefined>;

    write(data: T | Array<T>): boolean;

    close(): void;
}



export interface CloseData {
    code: number;
    reason?: string;
}



export class TimeoutError extends Error {

    constructor(message?: string) {
        super(message ? `timeout: ${message}` : "timeout");
    }
}


export class UnexpectedEOFError extends Error {
    
    constructor(message?: string) {
        super(message ? `unexpected eof: ${message}` : "unexpected eof");
    }
}
    


export class WebSocketError extends Error {

    readonly source?: Event;
    readonly status: number;

    constructor(status: number, ev?: Event) {
        let message: string;
        if (ev) {
            message = `WebSocketError(${status}) ${ev}`;
        } else {
            message = `WebSocketError(${status}) invalid-state`;
        }
        super(message);
        this.status = status;
        this.source = ev;
    }

    get isInvalidState(): boolean {
        return this.source === undefined;
    }
}



interface Item {
    ty: 0x1 | 0x2 | 0x4 | 0x8 | 0x14 | 0x18; // error, close, open, message; recv-open, recv-message
    ev?: Event;
}

interface OpenItem extends Item {
    ty: 0x4;
    ev: Event;
}

interface CloseItem extends Item {
    ty: 0x2;
    ev: CloseEvent;
}

interface MessageItem extends Item {
    ty: 0x8;
    ev: MessageEvent;
    data: Uint8Array;
}

interface ErrorItem extends Item {
    ty: 0x1;
    ev: Event;
}

interface RecvOpenItem extends Item {
    ty: 0x14;
    h?: number; // setTimeout handle
    resolve: (self: WebSocketStream) => void;
    reject: (err: Error) => void;
}

interface RecvMessageItem extends Item {
    ty: 0x18;
    h?: number; // setTimeout handle
    resolve: (data?: ArrayBuffer) => void;
    reject: (err: Error) => void;
}

export class WebSocketStream implements Stream<Uint8Array> {

    private socket: WebSocket;
    private itemOpen?: OpenItem | RecvOpenItem;
    private queueMsg: Array<ErrorItem | CloseItem | MessageItem | RecvMessageItem>;
    private closeCode?: number;
    private closeReason?: string;

    private constructor(url: string | URL) {
        this.itemOpen = undefined;
        this.queueMsg = [];
        this.closeCode = undefined;
        this.closeReason = undefined;
        this.socket = new WebSocket(url);
        this.socket.binaryType = "arraybuffer";
        this.socket.onopen = this.onOpen.bind(this);
        this.socket.onclose = this.onClose.bind(this);
        this.socket.onerror = this.onError.bind(this);
        this.socket.onmessage = this.onMessage.bind(this);
    }

    private open(timeout?: number): Promise<WebSocketStream> {
        return new Promise((resolve, reject) => {
            const item = this.itemOpen;
            if (item && item.ty === 0x4) {
                const openItem = item as OpenItem;
                this.itemOpen = undefined;
                resolve(this);
            } else {
                if (this.socket.readyState !== WebSocket.CONNECTING && this.socket.readyState !== WebSocket.OPEN) {
                    reject(new WebSocketError(this.socket.readyState));
                } else {
                    const openExec = { ty: 0x14, resolve, reject } as RecvOpenItem;
                    if (timeout) {
                        openExec.h = setTimeout(this.cancelOpenExec.bind(this, openExec), timeout);
                    }
                    this.itemOpen = openExec;
                }
            }
        });
    }

    read(timeout?: number): Promise<Uint8Array | undefined> {
        return new Promise((resolve, reject) => {
            const queue = this.queueMsg;
            if (queue.length > 0 && (queue[0].ty === 0x1 || queue[0].ty === 0x2 || queue[0].ty === 0x8)) {
                const item = queue.shift() as MessageItem;
                if (item.ty === 0x8) {
                    resolve(item.data);
                } else if (item.ty === 0x2) {
                    resolve(undefined);
                } else {
                    reject(new WebSocketError(this.socket.readyState, item.ev));
                }
            } else {
                if (this.socket.readyState !== WebSocket.OPEN) {
                    reject(new WebSocketError(this.socket.readyState));
                } else {
                    let recvExec = { ty: 0x18, resolve, reject } as RecvMessageItem;
                    if (timeout) {
                        recvExec.h = setTimeout(this.cancelMessageExec.bind(this, recvExec), timeout);
                    }
                    queue.push(recvExec);
                }
            }
        });
    }

    write(data: Uint8Array | Array<Uint8Array>): boolean {
        if (this.socket.readyState === WebSocket.OPEN) {
            if (data instanceof Array) {
                for (const d of data) {
                    this.socket.send(d);
                }
            } else {
                this.socket.send(data);
            }
            return true;
        } else {
            return false;
        }
    }

    close(): void {
        this.socket.close();
    }

    get state(): number {
        return this.socket.readyState;
    }

    get closed(): CloseData | undefined {
        return this.closeCode === undefined ? undefined : { code: this.closeCode, reason: this.closeReason };
    }

    private onOpen(ev: Event): void {
        const item = this.itemOpen;
        if (item) {
            if (item.ty === 0x14) {
                const openItem = item as RecvOpenItem;
                if (openItem.h) {
                    clearTimeout(openItem.h);
                }
                openItem.resolve(this);
                this.itemOpen = undefined;
            } else {
                throw new Error("Unreachable");
            }
        } else {
            this.itemOpen = { ty: 0x4, ev } as OpenItem;
        }
    }

    private onClose(ev: CloseEvent): void {
        const item = this.itemOpen;
        if (item) {
            if (item.ty === 0x14) {
                const openItem = item as RecvOpenItem;
                if (openItem.h) {
                    clearTimeout(openItem.h);
                }
                openItem.reject(new WebSocketError(this.socket.readyState, ev));
                this.itemOpen = undefined;
            }
        }
        this.closeCode = ev.code;
        this.closeReason = ev.reason;
        let itemClose: CloseItem | undefined = { ty: 0x2, ev } as CloseItem;
        const queue = this.queueMsg;
        if (queue.length > 0 && queue[0].ty === 0x18) {
            for (const item of queue) {
                const exec = item as RecvMessageItem;
                if (exec.h) {
                    clearTimeout(exec.h);
                }
                if (itemClose) {
                    exec.resolve();
                    itemClose = undefined;
                } else {
                    exec.reject(new WebSocketError(this.socket.readyState, ev));
                }
            }
            queue.splice(0)
        } else {
            queue.push(itemClose);
        }
    }

    private onError(ev: Event): void {
        const item = this.itemOpen;
        if (item) {
            if (item.ty === 0x14) {
                const openItem = item as RecvOpenItem;
                if (openItem.h) {
                    clearTimeout(openItem.h);
                }
                openItem.reject(new WebSocketError(this.socket.readyState, ev));
                this.itemOpen = undefined;
            }
        }
        let itemError: ErrorItem | undefined = { ty: 0x1, ev } as ErrorItem;
        const queue = this.queueMsg;
        if (queue.length > 0 && queue[0].ty === 0x18) {
            for (const item of queue) {
                const exec = item as RecvMessageItem;
                if (exec.h) {
                    clearTimeout(exec.h);
                }
                exec.reject(new WebSocketError(this.socket.readyState, ev));
            }
            queue.splice(0)
        } else {
            queue.push(itemError);
        }
    }

    private onMessage(ev: MessageEvent): void {
        let data: Uint8Array;
        if (ev.data instanceof ArrayBuffer) {
            data = new Uint8Array(ev.data);
        } else {
            const encoder = new TextEncoder();
            data = encoder.encode(ev.data);
        }
        const queue = this.queueMsg;
        if (queue.length > 0 && queue[0].ty === 0x18) {
            const exec = queue.shift() as RecvMessageItem;
            if (exec.h) {
                clearTimeout(exec.h);
            }
            exec.resolve(data);
        } else {
            queue.push({ ty: 0x8, ev, data } as MessageItem);
        }
    }

    private cancelOpenExec(tgt: RecvOpenItem): void {
        if (this.itemOpen === tgt) {
            this.itemOpen = undefined;
        }
        tgt.reject(new TimeoutError());
    }

    private cancelMessageExec(tgt: RecvMessageItem): void {
        const i = this.queueMsg.indexOf(tgt);
        if (i >= 0) {
            this.queueMsg.splice(i, 1);
        }
        tgt.reject(new TimeoutError());
    }

    static connect(url: string | URL, timeout?: number): Promise<WebSocketStream> {
        let s = new WebSocketStream(url);
        return s.open(timeout);
    }
}



interface Buf {
    data: ArrayBuffer;
    start: number; // read index
    end: number; // write index
}

function createBuf(data: Uint8Array): Buf {
    return {
        data: data.buffer,
        start: data.byteOffset,
        end: data.byteOffset + data.length,
    };
}

function appendBuf(buf: Buf, data: Uint8Array, expandScale?: number): void {
    let view: Uint8Array;
    if (buf.end + data.length > buf.data.byteLength) {
        expandScale = expandScale || 2;
        const newSize = Math.ceil(buf.data.byteLength * expandScale) << 0x0;
        const oldView = new Uint8Array(buf.data, buf.start, buf.end - buf.start);
        view = new Uint8Array(newSize);
        view.set(oldView);
        buf.data = view.buffer;
        buf.start = view.byteOffset;
        buf.end = view.byteOffset + oldView.length;
    } else {
        view = new Uint8Array(buf.data);
    }
    view.set(data, buf.end);
}



export abstract class MessageStream<T> implements Stream<T> {

    protected stream: WebSocketStream;
    private recv?: Buf
    private queue: Array<T>;

    protected constructor(stream: WebSocketStream) {
        this.stream = stream;
        this.recv = undefined;
        this.queue = [];
    }

    protected abstract encode(message: T): Uint8Array;

    protected abstract decode(data: Uint8Array, outList: Array<T>): number;

    read(timeout?: number): Promise<T | undefined> {
        return new Promise((resolve, reject) => {
            if (this.queue.length === 0) {
                this.readInner(timeout).then(resolve).catch(reject);
            } else {
                resolve(this.queue.shift());
            }
        });
    }

    write(data: T | Array<T>): boolean {
        if (this.stream.state === WebSocket.OPEN) {
            if (data instanceof Array) {
                if (data.length > 1) {
                    let buf: Buf | undefined;
                    let expandScale = data.length;
                    for (const d of data) {
                        const raw = this.encode(d);
                        if (buf) {
                            appendBuf(buf, raw, expandScale);
                            expandScale = 2;
                        } else {
                            buf = createBuf(raw);
                        }
                    }
                    const buf0 = buf!;
                    const raw = new Uint8Array(buf0.data, buf0.start, buf0.end - buf0.start);
                    return this.stream.write(raw);
                } else if (data.length === 1) {
                    const d = data[0];
                    const raw = this.encode(d);
                    return this.stream.write(raw);
                } else {
                    return false;
                }
            } else {
                const raw = this.encode(data);
                return this.stream.write(raw);
            }
        } else {
            return false;
        }
    }

    close(): void {
        this.stream.close();
    }

    private async readInner(timeout?: number): Promise<T | undefined> {
        const outList = this.queue;
        while (outList.length === 0) {
            const raw = await this.stream.read(timeout); // todo: timeout modify
            if (!raw) {
                if (this.recv) {
                    throw new UnexpectedEOFError();
                }
                return undefined;
            }
            let buf: Buf;
            if (this.recv) {
                appendBuf(buf = this.recv, raw);
            } else {
                buf = this.recv = createBuf(raw);
            }
            let oldCount = outList.length - 1;
            while (oldCount < outList.length) {
                oldCount = outList.length;
                const data = new Uint8Array(buf.data, buf.start, buf.end - buf.start);
                const numRead = this.decode(data, outList);
                buf.start += numRead;
            }
            if (buf.start === buf.end) {
                this.recv = undefined;
            }
        }
        return outList.shift();
    }
}