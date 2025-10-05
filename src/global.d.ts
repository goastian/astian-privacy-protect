// Declaraciones de tipos globales para la extensión

declare namespace chrome {
    namespace runtime {
        function sendMessage(message: any, callback?: (response: any) => void): void;
        function openOptionsPage(): void;
        const lastError: { message: string } | undefined;

        namespace onInstalled {
            function addListener(callback: (details: any) => void): void;
        }

        namespace onStartup {
            function addListener(callback: () => void): void;
        }

        namespace onMessage {
            function addListener(callback: (request: any, sender: any, sendResponse: (response: any) => void) => void): void;
        }

        namespace onSuspend {
            function addListener(callback: () => void): void;
        }
    }

    namespace storage {
        namespace local {
            function get(keys: string[], callback: (result: any) => void): void;
            function set(items: any, callback?: () => void): void;
        }
    }

    namespace tabs {
        function onUpdated(callback: (tabId: number, changeInfo: any, tab: any) => void): void;
        function onActivated(callback: (activeInfo: any) => void): void;
    }

    namespace action {
        function setBadgeText(details: { text: string }): void;
        function setBadgeBackgroundColor(details: { color: string }): void;
    }

    namespace webRequest {
        interface WebRequestBodyDetails {
            url: string;
            tabId?: number;
            type: string;
            requestBody?: {
                formData?: any;
                raw?: Array<{ bytes?: Uint8Array }>;
            };
        }

        function onBeforeRequest(
            callback: (details: WebRequestBodyDetails) => void,
            filter: { urls: string[] },
            extraInfoSpec: string[]
        ): void;

        function onBeforeRequest(
            callback: (details: WebRequestBodyDetails) => void
        ): void;
    }
}

// Declaraciones para el objeto global
declare const self: ServiceWorkerGlobalScope;

// Declaraciones para elementos del DOM
interface HTMLElement {
    style: CSSStyleDeclaration;
}

interface HTMLInputElement extends HTMLElement {
    checked: boolean;
    value: string;
}

interface HTMLSelectElement extends HTMLElement {
    value: string;
}

interface HTMLButtonElement extends HTMLElement {
    textContent: string | null;
    innerHTML: string;
    classList: DOMTokenList;
    addEventListener(type: string, listener: EventListener): void;
}

interface HTMLIFrameElement extends HTMLElement {
    src: string;
}

// Declaraciones para eventos
interface Event {
    key: string;
    target: EventTarget | null;
}

interface EventTarget {
    files: FileList | null;
    result: string | ArrayBuffer | null;
}

interface FileList {
    readonly length: number;
    item(index: number): File | null;
    [index: number]: File;
}

interface File {
    readonly name: string;
    readonly size: number;
    readonly type: string;
}

// Declaraciones para el DOM
interface Document {
    getElementById(elementId: string): HTMLElement | null;
    querySelector(selectors: string): Element | null;
    querySelectorAll(selectors: string): NodeListOf<Element>;
    createElement(tagName: string): HTMLElement;
    addEventListener(type: string, listener: EventListener): void;
    head: HTMLHeadElement;
    body: HTMLBodyElement;
}

interface HTMLHeadElement extends HTMLElement {
    appendChild(node: Node): Node;
}

interface HTMLBodyElement extends HTMLElement {
    appendChild(node: Node): Node;
    removeChild(node: Node): Node;
}

interface Element extends Node {
    tagName: string;
    className: string;
    id: string;
    classList: DOMTokenList;
    style: CSSStyleDeclaration;
    textContent: string | null;
    innerHTML: string;
    querySelector(selectors: string): Element | null;
    querySelectorAll(selectors: string): NodeListOf<Element>;
    addEventListener(type: string, listener: EventListener): void;
}

interface Node {
    nodeType: number;
    readonly ELEMENT_NODE: number;
}

interface NodeListOf<T> {
    readonly length: number;
    item(index: number): T | null;
    forEach(callbackfn: (value: T, index: number, list: NodeListOf<T>) => void): void;
    [index: number]: T;
}

interface DOMTokenList {
    add(token: string): void;
    remove(token: string): void;
    contains(token: string): boolean;
    readonly length: number;
    item(index: number): string | null;
    [index: number]: string;
}

interface CSSStyleDeclaration {
    display: string;
    visibility: string;
    opacity: string;
    height: string;
    width: string;
    overflow: string;
    position: string;
    top: string;
    right: string;
    background: string;
    color: string;
    padding: string;
    borderRadius: string;
    fontSize: string;
    zIndex: string;
    animation: string;
    transform: string;
    transition: string;
    boxShadow: string;
    border: string;
    borderColor: string;
    outline: string;
}

// Declaraciones para Window
interface Window {
    location: Location;
    addEventListener(type: string, listener: EventListener): void;
    contentAdBlocker?: any;
}

interface Location {
    href: string;
}

// Declaraciones para Service Worker
interface ServiceWorkerGlobalScope {
    addEventListener(type: string, listener: EventListener): void;
}

// Declaraciones para FileReader
interface FileReader {
    onload: ((this: FileReader, ev: ProgressEvent<FileReader>) => any) | null;
    readAsText(file: File): void;
}

interface ProgressEvent<T> {
    target: T | null;
}

// Declaraciones para URL
interface URL {
    hostname: string;
}

declare const URL: {
    new(url: string, base?: string): URL;
};

// Declaraciones para Blob
interface Blob {
    readonly size: number;
    readonly type: string;
}

declare const Blob: {
    new(fileBits: BlobPart[], options?: BlobPropertyBag): Blob;
};

interface BlobPart {
    // Puede ser string, ArrayBuffer, Blob, etc.
}

interface BlobPropertyBag {
    type?: string;
}

// Declaraciones para URL.createObjectURL
declare const URL: {
    createObjectURL(object: Blob): string;
    revokeObjectURL(url: string): void;
};

// Declaraciones para console
interface Console {
    log(...args: any[]): void;
    error(...args: any[]): void;
    warn(...args: any[]): void;
}

declare const console: Console;

// Declaraciones para JSON
declare const JSON: {
    stringify(value: any, replacer?: (key: string, value: any) => any, space?: string | number): string;
    parse(text: string, reviver?: (key: string, value: any) => any): any;
};

// Declaraciones para Math
declare const Math: {
    floor(x: number): number;
    log(x: number): number;
    pow(x: number, y: number): number;
    min(...values: number[]): number;
};

// Declaraciones para Object
declare const Object: {
    entries<T>(o: { [s: string]: T }): [string, T][];
    values<T>(o: { [s: string]: T }): T[];
};

// Declaraciones para Array
interface Array<T> {
    reduce<U>(callbackfn: (previousValue: U, currentValue: T, currentIndex: number, array: T[]) => U, initialValue: U): U;
    slice(start?: number, end?: number): T[];
    push(...items: T[]): number;
    filter(callbackfn: (value: T, index: number, array: T[]) => boolean): T[];
    forEach(callbackfn: (value: T, index: number, array: T[]) => void): void;
    sort(compareFn?: (a: T, b: T) => number): T[];
    map<U>(callbackfn: (value: T, index: number, array: T[]) => U): U[];
    includes(searchElement: T): boolean;
    some(predicate: (value: T, index: number, array: T[]) => boolean): boolean;
}

// Declaraciones para Promise
interface Promise<T> {
    then<TResult1 = T, TResult2 = never>(
        onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null,
        onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null
    ): Promise<TResult1 | TResult2>;
    catch<TResult = never>(
        onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null
    ): Promise<T | TResult>;
}

declare const Promise: {
    new <T>(executor: (resolve: (value: T | PromiseLike<T>) => void, reject: (reason?: any) => void) => void): Promise<T>;
};

// Declaraciones para setTimeout
declare function setTimeout(callback: () => void, ms: number): number;
declare function setInterval(callback: () => void, ms: number): number;

// Declaraciones para confirm
declare function confirm(message: string): boolean;

// Declaraciones para alert
declare function alert(message: string): void;

// Declaraciones para browser (Firefox)
declare const browser: any;

