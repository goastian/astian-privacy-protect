/*******************************************************************************

    Midori Privacy - read-only Midori VPN status bridge

    The blocker does not control the VPN. A companion Midori component can
    publish its current state through `browser.runtime.sendMessage()` using:

        { action: 'midori-vpn-status', source: 'midori-vpn', state: 'connected' }

    Only the three product states below are accepted. Status expires quickly so
    the popup falls back to "off" instead of showing a stale secure connection.

*/

const VPN_STATUS_ACTION = 'midori-vpn-status';
const VPN_STATUS_TTL = 30_000;
const VPN_EXTENSION_IDS = new Set([ 'midori-vpn@astian.org' ]);
const vpnStates = new Set([ 'off', 'connecting', 'connected' ]);

let currentStatus = {
    state: 'off',
    updatedAt: 0,
};

const normalizeStatus = status => {
    if (
        status instanceof Object === false ||
        vpnStates.has(status.state) === false
    ) {
        return { state: 'off', updatedAt: 0 };
    }

    const updatedAt = Number.isFinite(status.updatedAt)
        ? status.updatedAt
        : Date.now();
    if ( status.state !== 'off' && Date.now() - updatedAt > VPN_STATUS_TTL ) {
        return { state: 'off', updatedAt: 0 };
    }

    return {
        state: status.state,
        updatedAt,
    };
};

const onExternalMessage = (request, sender, sendResponse) => {
    if (
        request instanceof Object === false ||
        request.action !== VPN_STATUS_ACTION ||
        request.source !== 'midori-vpn' ||
        VPN_EXTENSION_IDS.has(sender?.id) === false ||
        vpnStates.has(request.state) === false
    ) {
        return;
    }

    currentStatus = {
        state: request.state,
        updatedAt: Date.now(),
    };
    sendResponse({ accepted: true });
};

if ( browser.runtime.onMessageExternal instanceof Object ) {
    browser.runtime.onMessageExternal.addListener(onExternalMessage);
}

const getMidoriVpnStatus = ( ) => {
    currentStatus = normalizeStatus(currentStatus);
    return { ...currentStatus };
};

export { getMidoriVpnStatus };
