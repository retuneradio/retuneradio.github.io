/*
 * ReTune's TV screen while casting (a Google Cast receiver, registered in the Cast SDK
 * Developer Console). The phone loads the station (its name, the genre and city, its logo,
 * ReTune's language) and, over ReTune's own line, the latest news headlines (the outlet's
 * name, the title, its time). Four states: ready (nothing playing), tuning in, playing,
 * paused; with headlines, the news shows in big cards and the station along the bottom.
 *
 * Opened in a browser with ?demo=playing|tuning|paused|ready|news, it shows a sample instead.
 */
(() => {
  'use strict';

  const NAMESPACE = 'urn:x-cast:com.retune.radio';
  // A page of three cards, then the next.
  const PAGE_MS = 12000;
  // Headlines older than this aren't news any more (the phone may have gone quiet).
  const MAX_AGE_MS = 12 * 3600000;
  // Stopped or failed: the Ready screen after a moment (the phone may try another address).
  const READY_AFTER_MS = 4000;
  // Everything moves a few pixels this often, so nothing burns into the TV.
  const DRIFT_MS = 60000;
  const MOST_HEADLINES = 21;

  const hours = minutes => Math.floor(minutes / 60);
  const WORDS = {
    el: {
      live: 'ΖΩΝΤΑΝΑ',
      tuning: 'ΣΥΝΤΟΝΙΣΜΟΣ…',
      paused: 'ΣΕ ΠΑΥΣΗ',
      resume: 'Πάτα Play στο κινητό για να συνεχίσει',
      pick: 'Διάλεξε έναν σταθμό στο κινητό σου',
      news: 'ΕΙΔΗΣΕΙΣ',
      ago: minutes =>
        minutes < 1
          ? 'τώρα'
          : minutes < 60
            ? `πριν ${minutes}′`
            : hours(minutes) === 1
              ? 'πριν 1 ώρα'
              : `πριν ${hours(minutes)} ώρες`,
    },
    en: {
      live: 'LIVE',
      tuning: 'TUNING IN…',
      paused: 'PAUSED',
      resume: 'Press Play on your phone to go on',
      pick: 'Pick a station on your phone',
      news: 'NEWS',
      ago: minutes => (minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} min ago` : `${hours(minutes)} h ago`),
    },
  };

  const body = document.body;
  const stage = document.getElementById('stage');
  const all = selector => Array.from(document.querySelectorAll(selector));
  const setText = (selector, text) =>
    all(selector).forEach(element => {
      element.textContent = text;
    });

  let lang = /^el\b/i.test(navigator.language || '') ? 'el' : 'en';
  let state = 'ready';
  /** { name, details, logo } of the station loaded last, or null. */
  let station = null;
  /** [{ source, title, time }], newest first; none: no news on the TV. */
  let headlines = [];
  let page = 0;
  let readyTimer = 0;

  function fit() {
    stage.style.setProperty('--scale', String(Math.min(innerWidth / 1920, innerHeight / 1080)));
  }

  function drift() {
    const shift = range => `${Math.round((Math.random() * 2 - 1) * range)}px`;
    stage.style.setProperty('--dx', shift(16));
    stage.style.setProperty('--dy', shift(10));
  }

  function clock() {
    // 24 hours, as in Greece and most of Europe; 12 on a TV set to US English.
    const twelve = lang === 'en' && /^en-US/i.test(navigator.language || '');
    const time = new Date().toLocaleTimeString(lang === 'el' ? 'el-GR' : 'en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: twelve,
    });
    setText('.clock', time);
  }

  /** A station without a logo shows its initials: "Radio Aegean 101.4" → "RA". */
  function initials(name) {
    const words = name.split(/\s+/).filter(word => /^\p{L}/u.test(word));
    return (words.slice(0, 2).map(word => word[0]).join('') || name.trim().charAt(0)).toUpperCase();
  }

  function showStation(next) {
    const newLogo = !station || station.logo !== next.logo;
    station = next;
    setText('.name', next.name);
    all('.big .name').forEach(element => element.classList.toggle('long', next.name.length > 16));
    setText('.initials', initials(next.name));
    if (!newLogo) {
      return;
    }
    all('.tile').forEach(tile => {
      const image = tile.querySelector('img');
      tile.classList.toggle('no-logo', !next.logo);
      if (next.logo) {
        image.onload = () => tile.classList.remove('no-logo');
        image.onerror = () => tile.classList.add('no-logo');
        image.src = next.logo;
      } else {
        image.removeAttribute('src');
      }
    });
  }

  function currentNews() {
    const now = Date.now();
    return headlines.filter(item => !item.time || now - item.time < MAX_AGE_MS);
  }

  function render() {
    const words = WORDS[lang];
    document.documentElement.lang = lang;
    body.dataset.state = state;
    body.dataset.layout = currentNews().length > 0 ? 'news' : 'big';
    setText('.pick', words.pick);
    setText('.news-title', words.news);
    setText('.pill-label', state === 'playing' ? words.live : state === 'paused' ? words.paused : words.tuning);
    if (station) {
      setText('.big .details', state === 'paused' ? words.resume : station.details);
      setText('.bar .details', station.details);
    }
    clock();
  }

  function setState(next) {
    clearTimeout(readyTimer);
    if (next === 'ready' && station && state !== 'ready') {
      readyTimer = setTimeout(() => {
        state = 'ready';
        render();
      }, READY_AFTER_MS);
      return;
    }
    state = next;
    render();
  }

  /** The page of cards now: the newest first, three at a time, the dots saying where. */
  function showPage() {
    const list = currentNews();
    const pages = Math.ceil(list.length / 3);
    if (pages === 0) {
      return;
    }
    page %= pages;
    const items = list.slice(page * 3, page * 3 + 3);
    const words = WORDS[lang];
    all('.card').forEach((card, index) => {
      const item = items[index];
      card.hidden = !item;
      if (!item) {
        return;
      }
      const minutes = Math.max(0, Math.floor((Date.now() - item.time) / 60000));
      card.querySelector('.source').textContent = item.source;
      card.querySelector('.ago').textContent = item.time ? ` · ${words.ago(minutes)}` : '';
      card.querySelector('.headline').textContent = item.title;
    });
    document.querySelector('.side').hidden = items.length < 2;
    document.querySelector('.dots').replaceChildren(
      ...Array.from({ length: pages > 1 ? pages : 0 }, (_, index) => {
        const dot = document.createElement('i');
        dot.className = index === page ? 'on' : '';
        return dot;
      }),
    );
  }

  function nextPage() {
    if (body.dataset.layout !== 'news' || state === 'ready') {
      return;
    }
    if (Math.ceil(currentNews().length / 3) <= 1) {
      // One page: its times still move on.
      showPage();
      render();
      return;
    }
    const cards = document.querySelector('.cards');
    cards.classList.add('swap');
    setTimeout(() => {
      page += 1;
      showPage();
      render();
      cards.classList.remove('swap');
    }, 450);
  }

  /** The phone's news: the headlines (none: no news on the TV) and ReTune's language. */
  function onNews(data) {
    if (data.lang === 'el' || data.lang === 'en') {
      lang = data.lang;
    }
    headlines = (Array.isArray(data.headlines) ? data.headlines : [])
      .filter(item => item && typeof item.title === 'string' && typeof item.source === 'string')
      .slice(0, MOST_HEADLINES)
      .map(item => ({ source: item.source.slice(0, 40), title: item.title.slice(0, 240), time: Number(item.time) || 0 }));
    page = 0;
    showPage();
    render();
  }

  function startCast() {
    const context = cast.framework.CastReceiverContext.getInstance();
    const player = context.getPlayerManager();
    const { Command, IdleReason, MessageType, PlayerState } = cast.framework.messages;
    player.setMediaElement(document.getElementById('media'));

    // A station loading: what it is, at once (it plays a moment later).
    player.setMessageInterceptor(MessageType.LOAD, request => {
      const media = request.media || {};
      const metadata = media.metadata || {};
      const custom = media.customData || {};
      if (custom.lang === 'el' || custom.lang === 'en') {
        lang = custom.lang;
      }
      const image = (metadata.images || [])[0];
      showStation({
        name: String(metadata.title || ''),
        details: String(metadata.subtitle || ''),
        logo: image && image.url ? String(image.url) : '',
      });
      setState('tuning');
      return request;
    });

    player.addEventListener(cast.framework.events.EventType.MEDIA_STATUS, event => {
      const status = event.mediaStatus;
      if (!status) {
        return;
      }
      if (status.playerState === PlayerState.PLAYING) {
        setState('playing');
      } else if (status.playerState === PlayerState.PAUSED) {
        setState('paused');
      } else if (status.playerState === PlayerState.BUFFERING) {
        setState('tuning');
      } else if (status.playerState === PlayerState.IDLE && status.idleReason && status.idleReason !== IdleReason.INTERRUPTED) {
        // Stopped, ended or failed (a station changing is "interrupted": it goes on tuning).
        setState('ready');
      }
    });

    context.addCustomMessageListener(NAMESPACE, event => {
      let data = event.data;
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data);
        } catch {
          return;
        }
      }
      if (data && data.type === 'news') {
        onNews(data);
      }
    });

    const options = new cast.framework.CastReceiverOptions();
    options.customNamespaces = { [NAMESPACE]: cast.framework.system.MessageType.JSON };
    // Live radio: pause and volume, no seeking.
    options.supportedCommands = Command.PAUSE | Command.STREAM_VOLUME | Command.STREAM_MUTE;
    context.start(options);
  }

  /** In a browser: a sample of each screen, to look at the design. */
  function startDemo() {
    const demo = new URLSearchParams(location.search).get('demo') || 'playing';
    const greek = lang === 'el';
    showStation({
      name: 'ReTune Radio 99.9',
      details: greek ? 'Ελληνική μουσική · Αθήνα' : 'Greek music · Athens',
      logo: '',
    });
    if (demo === 'news') {
      const now = Date.now();
      onNews({
        type: 'news',
        lang,
        headlines: [5, 18, 32, 47, 61, 90].map((minutes, index) => ({
          source: 'ReTune',
          title: greek
            ? `Δείγμα τίτλου ${index + 1}: εδώ φαίνονται οι τελευταίες ειδήσεις, σε μεγάλες κάρτες`
            : `Sample headline ${index + 1}: the latest news shows here, in big cards`,
          time: now - minutes * 60000,
        })),
      });
    }
    state = demo === 'news' ? 'playing' : ['playing', 'tuning', 'paused', 'ready'].includes(demo) ? demo : 'playing';
    render();
  }

  fit();
  addEventListener('resize', fit);
  setInterval(drift, DRIFT_MS);
  setInterval(clock, 10000);
  setInterval(nextPage, PAGE_MS);
  render();

  if (new URLSearchParams(location.search).has('demo') || typeof cast === 'undefined') {
    startDemo();
  } else {
    startCast();
  }
})();
