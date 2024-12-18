export class Handle<T> {

    private _value: T;
    private _invalid: boolean;
    private _onInvalid?: (value: T) => void;
    private _priorityHandleManager: PriorityHandleManager<T>;

    constructor(value: T, priorityHandleManager: PriorityHandleManager<T>) {
        this._value = value;
        this._invalid = false;
        this._onInvalid = undefined;
        this._priorityHandleManager = priorityHandleManager;
    }

    /**
     * the resource hold by this handle
     */
    get value(): T {
        return this._value;
    }

    /**
     * callback when the handle become invalid
     */
    set onInvalid(value: (value: T) => void) {
        this._onInvalid = value;
        if (this._invalid) {
            newTask(this._onInvalid, this._value);
        }
    }

    /**
     * release the handle
     */
    release(): void {
        if (!this._invalid) {
            this._priorityHandleManager.remove(this);
        }
    }

    _makeInvalid(): void {
        this._invalid = true;
        if (this._onInvalid) {
            this._onInvalid(this._value);
        }
    }
}

function newTask<T, U>(action: (arg: T) => U, arg: T): Promise<U> {
    return new Promise((resolve, reject) => {
        try {
            resolve(action(arg));
        } catch (e) {
            reject(e);
        }
    });
}

interface PriorityHandleElement<T> {
    priority?: number;
    handle?: Handle<T>;
    resolve?: (value: Handle<T>) => void;
    reject?: (reason?: Error) => void;
}

interface PriorityHandleElementPending<T> extends PriorityHandleElement<T> {
    resolve: (value: Handle<T>) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    reject: (reason?: any) => void;
}

interface PriorityHandleElementReady<T> extends PriorityHandleElement<T> {
    handle: Handle<T>;
}

export class PriorityHandleManager<T> {

    private _handles: Array<PriorityHandleElement<T>>;
    private _invalid: boolean;
    private _createHandle?: (mgr: PriorityHandleManager<T>) => Handle<T>;

    constructor() {
        this._handles = [];
        this._invalid = false;
        this._createHandle = undefined;
    }

    add(priority?: number): Promise<Handle<T>> {
        return new Promise((resolve, reject) => {
            if (this._invalid) {
                reject(new Error("closed"));
                return;
            }
            const element: PriorityHandleElementPending<T> = { priority, resolve, reject };
            let insert: number; 
            if (priority === undefined || this._handles.length === 0) {
                insert = this._handles.length;
                this._handles.push(element);
            } else {
                insert = this._handles.findIndex((e) => {
                    if (e.priority === undefined) {
                        return true;
                    }
                    return priority < e.priority;
                });
                if (insert < 0) {
                    insert = this._handles.length;
                }
                this._handles.splice(insert, 0, element);
            }
            if (this._createHandle) {
                try {
                    const handle = this._createHandle(this);
                    element.handle = handle;
                    element.resolve(handle);
                    (element as PriorityHandleElement<T>).resolve = undefined;
                    (element as PriorityHandleElement<T>).reject = undefined;
                } catch (e) {
                    element.reject(e);
                    this._handles.splice(insert, 1);
                }
            }
        });
    }

    remove(handle: Handle<T>): boolean {
        if (this._invalid) {
            return false;
        }
        if (!this._createHandle) {
            return false;
        }
        const index = this._handles.findIndex((e) => e.handle === handle);
        if (index < 0) {
            return false;
        }
        const removed = this._handles.splice(index, 1);
        const element = removed[0] as PriorityHandleElementReady<T>;
        try {
            element.handle._makeInvalid();
        } catch (e) {
            console.error(e);
        }
        return true;
    }

    makeReady(createHandle: (mgr: PriorityHandleManager<T>) => Handle<T>): void {
        if (this._invalid) {
            return;
        }
        const needResolve = !this._createHandle;
        this._createHandle = createHandle;
        if (needResolve) {
            let needFilter = false;
            for (const element of this._handles) {
                try {
                    const handle = this._createHandle(this);
                    element.handle = handle;
                    (element as PriorityHandleElementPending<T>).resolve(handle);
                } catch (e) {
                    needFilter = true;
                    (element as PriorityHandleElementPending<T>).reject(e);
                } finally {
                    element.resolve = undefined;
                    element.reject = undefined;
                }
            }
            if (needFilter) {
                this._handles = this._handles.filter((e) => e.handle || (e.resolve && e.reject));
            }
        }
    }

    makeInvalid(): void {
        if (this._invalid) {
            return;
        }
        this._invalid = true;
        if (this._createHandle) {
            for (const element of this._handles) {
                const element0 = element as PriorityHandleElementReady<T>;
                try {
                    element0.handle._makeInvalid();
                } catch (e) {
                    console.error(e);
                }
            }
            this._createHandle = undefined;
        } else {
            for (const element of this._handles) {
                const element0 = element as PriorityHandleElementPending<T>;
                element0.reject(new Error("closed"));
            }
        }
        this._handles = [];
    }
}

