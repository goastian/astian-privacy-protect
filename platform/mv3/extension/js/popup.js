/*******************************************************************************

    uBlock Origin Lite - a comprehensive, MV3-compliant content blocker
    Copyright (C) 2022-present Raymond Hill

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see {http://www.gnu.org/licenses/}.

    Home: https://github.com/gorhill/uBlock
*/

import { browser, runtime, sendMessage } from './ext.js';
import { dom, qs$ } from './dom.js';
import { i18n$ } from './i18n.js';
import punycode from './punycode.js';

/******************************************************************************/

const popupPanelData = {};
const  currentTab = {};
const tabURL = new URL(runtime.getURL('/'));
const countFormatter = new Intl.NumberFormat(
    i18n$('@@ui_locale').replaceAll('_', '-')
);
let lastProtectedLevel = 2;

/******************************************************************************/

function renderAdminRules() {
    const { disabledFeatures: forbid = [] } = popupPanelData;
    if ( forbid.length === 0 ) { return; }
    dom.body.dataset.forbid = forbid.join(' ');
}

function renderProtectionLevel(level) {
    const isProtected = level !== 0;
    if ( isProtected ) {
        lastProtectedLevel = level;
    }
    dom.prop('#protectionToggle', 'checked', isProtected);
    dom.text(
        '.switchCopy strong',
        i18n$(isProtected ? 'midoriProtectionOn' : 'midoriProtectionOff')
    );
    dom.text(
        '.switchCopy small',
        i18n$(isProtected ?
            'midoriProtectionSwitchHint' :
            'midoriProtectionOffHint')
    );
    dom.body.dataset.protectionLevel = `${level}`;
    for ( const button of document.querySelectorAll('.modeChoices [data-level]') ) {
        const active = Number(button.dataset.level) === level;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', `${active}`);
    }
    const recommended = qs$('.statusPill');
    recommended.hidden = level !== 2;
}

function renderActivity(activity = {}) {
    const categories = [ 'ads', 'trackers', 'annoyances', 'threats', 'other' ];
    const total = Number(activity.total) || 0;
    dom.text('#blockedTotal', countFormatter.format(total));
    dom.text(
        '#activityHeadline',
        total === 0 ?
            i18n$('midoriNoBlocks') :
            i18n$('midoriBlockedCount', [ countFormatter.format(total) ])
    );
    dom.text(
        '#activityDetail',
        i18n$(activity.detailed ?
            'midoriActivityUpdates' :
            'midoriActivityTotalOnly')
    );
    dom.text(
        '#activityAvailability',
        i18n$(activity.detailed ?
            'midoriDetailedActivityAvailable' :
            'midoriDetailedActivityUnavailable')
    );

    const ringColors = {
        ads: 'var(--category-ads)',
        trackers: 'var(--category-trackers)',
        annoyances: 'var(--category-annoyances)',
        threats: 'var(--category-threats)',
        other: 'var(--category-other)',
    };
    const ringStops = [];
    let cursor = 0;
    for ( const category of categories ) {
        const count = Number(activity[category]) || 0;
        dom.text(`[data-category-count="${category}"]`, countFormatter.format(count));
        const share = total === 0 ? 0 : count / total * 100;
        const bar = qs$(`[data-category-bar="${category}"]`);
        bar.style.setProperty('--bar-height', `${Math.max(6, share)}%`);
        if ( share === 0 ) { continue; }
        const next = cursor + share;
        ringStops.push(`${ringColors[category]} ${cursor}% ${next}%`);
        cursor = next;
    }
    const donut = qs$('#activityDonut');
    donut.style.setProperty(
        '--activity-ring',
        ringStops.length === 0 ?
            'conic-gradient(var(--midori-border) 0 100%)' :
            `conic-gradient(${ringStops.join(',')})`
    );
}

function selectView(view) {
    for ( const button of document.querySelectorAll('.viewSwitch [data-view]') ) {
        const active = button.dataset.view === view;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', `${active}`);
        button.tabIndex = active ? 0 : -1;
    }
    for ( const panel of document.querySelectorAll('.viewPanel') ) {
        const active = panel.id === `${view}Panel`;
        panel.hidden = false;
        panel.classList.toggle('active', active);
        panel.setAttribute('aria-hidden', `${!active}`);
    }
}

async function refreshActivity() {
    if ( typeof currentTab.id !== 'number' ) { return; }
    const activity = await sendMessage({
        what: 'getTabActivity',
        tabId: currentTab.id,
    });
    if ( activity instanceof Object ) {
        renderActivity(activity);
    }
    self.setTimeout(refreshActivity, 750);
}

/******************************************************************************/

const BLOCKING_MODE_MAX = 3;

async function setFilteringMode(level, commit = false) {
    const modeSlider = qs$('.filteringModeSlider');
    modeSlider.dataset.level = level;
    if ( qs$('.filteringModeSlider.moving') === null ) {
        dom.text(
            '#filteringModeText > span:nth-of-type(1)',
            i18n$(`filteringMode${level}Name`)
        );
    }
    renderProtectionLevel(level);
    if ( commit !== true ) { return; }
    dom.cl.add(dom.body, 'busy');
    await commitFilteringMode();
    dom.cl.remove(dom.body, 'busy');
}

dom.on('#protectionToggle', 'change', ev => {
    const modeSlider = qs$('.filteringModeSlider');
    modeSlider.dataset.levelBefore = modeSlider.dataset.level;
    const level = ev.target.checked ? lastProtectedLevel : 0;
    setFilteringMode(level, true);
});

dom.on('.modeChoices', 'click', 'button[data-level]', ev => {
    const modeSlider = qs$('.filteringModeSlider');
    modeSlider.dataset.levelBefore = modeSlider.dataset.level;
    setFilteringMode(Number(ev.target.closest('[data-level]').dataset.level), true);
});

dom.on('.viewSwitch', 'click', 'button[data-view]', ev => {
    selectView(ev.target.closest('[data-view]').dataset.view);
});

dom.on('.viewSwitch', 'keydown', ev => {
    if ( ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight' ) { return; }
    const tabs = Array.from(document.querySelectorAll('.viewSwitch [data-view]'));
    const current = tabs.findIndex(tab => tab.classList.contains('active'));
    const direction = ev.key === 'ArrowRight' ? 1 : -1;
    const next = tabs[(current + direction + tabs.length) % tabs.length];
    selectView(next.dataset.view);
    next.focus();
    ev.preventDefault();
});

async function commitFilteringMode() {
    if ( tabURL.hostname === '' ) { return; }
    const targetHostname = tabURL.hostname;
    const modeSlider = qs$('.filteringModeSlider');
    const afterLevel = parseInt(modeSlider.dataset.level, 10);
    const beforeLevel = parseInt(modeSlider.dataset.levelBefore, 10);
    if ( afterLevel > 1 ) {
        if ( beforeLevel <= 1 ) {
            sendMessage({
                what: 'setPendingFilteringMode',
                tabId: currentTab.id,
                url: tabURL.href,
                hostname: targetHostname,
                beforeLevel,
                afterLevel,
            });
        }
        let granted = false;
        try {
            granted = await browser.permissions.request({
                origins: [ `*://*.${targetHostname}/*` ],
            });
        } catch {
        }
        if ( granted !== true ) {
            setFilteringMode(beforeLevel);
            return;
        }
    }
    dom.text(
        '#filteringModeText > span:nth-of-type(1)',
        i18n$(`filteringMode${afterLevel}Name`)
    );
    const actualLevel = await sendMessage({
        what: 'setFilteringMode',
        hostname: targetHostname,
        level: afterLevel,
    });
    if ( actualLevel !== afterLevel ) {
        setFilteringMode(actualLevel);
    }
    if ( actualLevel !== beforeLevel && popupPanelData.autoReload ) {
        const justReload = tabURL.href === currentTab.url;
        self.setTimeout(( ) => {
            if ( justReload ) {
                browser.tabs.reload(currentTab.id);
            } else {
                browser.tabs.update(currentTab.id, { url: tabURL.href });
            }
        }, 437);
    }
}

{
    let mx0 = 0;
    let mx1 = 0;
    let l0 = 0;
    let lMax = 0;
    let timer;

    const move = ( ) => {
        timer = undefined;
        const l1 = Math.min(Math.max(l0 + mx1 - mx0, 0), lMax);
        let level = Math.floor(l1 * BLOCKING_MODE_MAX / lMax);
        if ( qs$('body[dir="rtl"]') !== null ) {
            level = 3 - level;
        }
        const modeSlider = qs$('.filteringModeSlider');
        if ( `${level}` === modeSlider.dataset.level ) { return; }
        dom.text(
            '#filteringModeText > span:nth-of-type(2)',
            i18n$(`filteringMode${level}Name`)
        );
        setFilteringMode(level);
    };

    const moveAsync = ev => {
        if ( timer !== undefined ) { return; }
        mx1 = ev.pageX;
        timer = self.requestAnimationFrame(move);
    };

    const stop = ev => {
        if ( ev.button !== 0 ) { return; }
        const modeSlider = qs$('.filteringModeSlider');
        if ( dom.cl.has(modeSlider, 'moving') === false ) { return; }
        dom.cl.remove(modeSlider, 'moving');
        self.removeEventListener('mousemove', moveAsync, { capture: true });
        self.removeEventListener('mouseup', stop, { capture: true });
        dom.text('#filteringModeText > span:nth-of-type(2)', '');
        commitFilteringMode();
        ev.stopPropagation();
        ev.preventDefault();
        if ( timer !== undefined ) {
            self.cancelAnimationFrame(timer);
            timer = undefined;
        }
    };

    const startSliding = ev => {
        if ( ev.button !== 0 ) { return; }
        const modeButton = qs$('.filteringModeButton');
        if ( ev.currentTarget !== modeButton ) { return; }
        const modeSlider = qs$('.filteringModeSlider');
        if ( dom.cl.has(modeSlider, 'moving') ) { return; }
        modeSlider.dataset.levelBefore = modeSlider.dataset.level;
        mx0 = ev.pageX;
        const buttonRect = modeButton.getBoundingClientRect();
        l0 = buttonRect.left + buttonRect.width / 2;
        const sliderRect = modeSlider.getBoundingClientRect();
        lMax = sliderRect.width - buttonRect.width ;
        dom.cl.add(modeSlider, 'moving');
        self.addEventListener('mousemove', moveAsync, { capture: true });
        self.addEventListener('mouseup', stop, { capture: true });
        ev.stopPropagation();
        ev.preventDefault();
    };

    dom.on('.filteringModeButton', 'mousedown', startSliding);
}

dom.on(
    '.filteringModeSlider',
    'click',
    '.filteringModeSlider span[data-level]',
    ev => {
        const modeSlider = qs$('.filteringModeSlider');
        modeSlider.dataset.levelBefore = modeSlider.dataset.level;
        const span = ev.target;
        const level = parseInt(span.dataset.level, 10);
        setFilteringMode(level, true);
    }
);

if ( dom.cl.has(dom.html, 'mobile') === false ) {
    dom.on('.filteringModeSlider',
        'mouseenter',
        '.filteringModeSlider span[data-level]',
        ev => {
            const span = ev.target;
            const level = parseInt(span.dataset.level, 10);
            dom.text('#filteringModeText > span:nth-of-type(2)',
                i18n$(`filteringMode${level}Name`)
            );
        }
    );

    dom.on('.filteringModeSlider',
        'mouseleave',
        '.filteringModeSlider span[data-level]',
        ( ) => {
            dom.text('#filteringModeText > span:nth-of-type(2)', '');
        }
    );
}

/******************************************************************************/

dom.on('#gotoMatchedRules', 'click', ev => {
    if ( ev.isTrusted !== true ) { return; }
    if ( ev.button !== 0 ) { return; }
    sendMessage({
        what: 'showMatchedRules',
        tabId: currentTab.id,
    });
});

/******************************************************************************/

dom.on('#gotoReport', 'click', ev => {
    if ( ev.isTrusted !== true ) { return; }
    let url;
    try {
        url = new URL(currentTab.url);
    } catch {
    }
    if ( url === undefined ) { return; }
    const reportURL = new URL(runtime.getURL('/report.html'));
    reportURL.searchParams.set('tabid', currentTab.id);
    reportURL.searchParams.set('url', tabURL.href);
    reportURL.searchParams.set('mode', popupPanelData.level);
    sendMessage({
        what: 'gotoURL',
        url: `${reportURL.pathname}${reportURL.search}`,
    });
});

/******************************************************************************/

dom.on('#gotoDashboard', 'click', ev => {
    if ( ev.isTrusted !== true ) { return; }
    if ( ev.button !== 0 ) { return; }
    runtime.openOptionsPage();
});

/******************************************************************************/

dom.on('#gotoZapper', 'click', ( ) => {
    if ( browser.scripting === undefined ) { return; }
    browser.scripting.executeScript({
        files: [ '/js/scripting/tool-overlay.js', '/js/scripting/zapper.js' ],
        target: { tabId: currentTab.id },
    });
    self.close();
});

/******************************************************************************/

dom.on('#gotoPicker', 'click', ( ) => {
    if ( browser.scripting === undefined ) { return; }
    browser.scripting.executeScript({
        files: [
            '/js/scripting/css-procedural-api.js',
            '/js/scripting/tool-overlay.js',
            '/js/scripting/picker.js',
        ],
        target: { tabId: currentTab.id },
    });
    self.close();
});

/******************************************************************************/

dom.on('#gotoUnpicker', 'click', ( ) => {
    if ( browser.scripting === undefined ) { return; }
    browser.scripting.executeScript({
        files: [
            '/js/scripting/css-procedural-api.js',
            '/js/scripting/tool-overlay.js',
            '/js/scripting/unpicker.js',
        ],
        target: { tabId: currentTab.id },
    });
    self.close();
});

/******************************************************************************/

async function init() {
    const [ tab ] = await browser.tabs.query({
        active: true,
        currentWindow: true,
    });
    if ( tab instanceof Object === false ) { return true; }
    Object.assign(currentTab, tab);

    let url;
    try {
        const strictBlockURL = runtime.getURL('/strictblock.');
        url = new URL(currentTab.url);
        if ( url.href.startsWith(strictBlockURL) ) {
            url = new URL(url.hash.slice(1));
        }
        tabURL.href = url.href || '';
    } catch {
        return false;
    }

    if ( url !== undefined ) {
        const response = await sendMessage({
            what: 'popupPanelData',
            origin: url.origin,
            hostname: tabURL.hostname,
            tabId: currentTab.id,
        });
        if ( response instanceof Object ) {
            Object.assign(popupPanelData, response);
        }
    }

    renderAdminRules();

    setFilteringMode(popupPanelData.level);
    renderActivity(popupPanelData.activity);
    selectView('actions');

    dom.text('#hostname', punycode.toUnicode(tabURL.hostname));

    dom.cl.toggle('#gotoMatchedRules', 'enabled',
        popupPanelData.isSideloaded === true &&
        popupPanelData.developerMode &&
        typeof currentTab.id === 'number' &&
        isNaN(currentTab.id) === false
    );

    const isHTTP = url.protocol === 'http:' || url.protocol === 'https:';
    dom.cl.toggle(dom.root, 'isHTTP', isHTTP);

    dom.cl.toggle('#gotoUnpicker', 'enabled', popupPanelData.hasCustomFilters);

    self.setTimeout(refreshActivity, 750);

    return true;
}

async function tryInit() {
    try {
        await init();
    } catch {
        setTimeout(tryInit, 100);
    } finally {
        dom.cl.remove(dom.body, 'loading', 'busy');
    }
}

tryInit();

/******************************************************************************/
