/*
 * ReTune's TV screen while casting (a Google Cast receiver, registered in the Cast SDK
 * Developer Console). The phone loads the station (its name, the genre and city, its logo,
 * ReTune's language) and, over ReTune's own line, the latest news headlines (the outlet's
 * name, the title, its time, its photo). Four states: ready (nothing playing), tuning in,
 * playing, paused; with headlines, the news shows in big cards (three at a time, sliding in
 * from the right) and the station along the bottom.
 *
 * Opened in a browser with ?demo=playing|tuning|paused|ready|news, it shows a sample instead.
 */
(() => {
  'use strict';

  const NAMESPACE = 'urn:x-cast:com.retune.radio';
  // How long a page of three cards stays before the next slides in.
  const PAGE_MS = 30000;
  // Headlines older than this aren't news any more (the phone may have gone quiet).
  const MAX_AGE_MS = 12 * 3600000;
  // Stopped or failed: the Ready screen after a moment (the phone may try another address).
  const READY_AFTER_MS = 4000;
  // Everything moves a few pixels this often, so nothing burns into the TV.
  const DRIFT_MS = 60000;
  const MOST_HEADLINES = 21;
  // A page waiting off the right edge of the screen, and one gone past the left.
  const SLIDE_PX = 1760;
  // Smaller than this, a "photo" is an icon or a tracking pixel: the card stays plain.
  const SMALLEST_PHOTO = 320;

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
  /** [{ source, title, time, image? }], newest first; none: no news on the TV. */
  let headlines = [];
  let readyTimer = 0;

  // ---- Fitting the TV, and drifting so nothing burns in ----

  /** The 1920×1080 drawing, scaled to the TV, and how far it has drifted. */
  let scale = 0;
  let dx = 0;
  let dy = 0;

  function place(animate) {
    stage.style.transition = animate ? 'transform 4s ease-in-out' : 'none';
    stage.style.transform = `translate(-50%, -50%) scale(${scale}) translate(${dx}px, ${dy}px)`;
  }

  // The size the page really has (what centring it uses), not what the window claims: some TV
  // boxes give the page 1280×720 while saying 1920×1080 at first. Measured again now and then.
  function fit() {
    const root = document.documentElement;
    const width = root.clientWidth || innerWidth;
    const height = root.clientHeight || innerHeight;
    const next = Math.min(width / 1920, height / 1080);
    if (next > 0 && Math.abs(next - scale) > 0.001) {
      scale = next;
      place(false);
    }
  }

  function drift() {
    const shift = range => Math.round((Math.random() * 2 - 1) * range);
    dx = shift(16);
    dy = shift(10);
    place(true);
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

  // ---- The station ----

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

  // ---- The news: pages of three cards, sliding from right to left ----

  const pages = all('.page');
  /** Which of the two pages is on screen; the other waits off the right edge, filled. */
  let front = 0;
  /** The page of headlines on screen (0: the newest three). */
  let page = 0;
  let pageTimer = 0;

  function currentNews() {
    const now = Date.now();
    return headlines.filter(item => !item.time || now - item.time < MAX_AGE_MS);
  }

  function pageCount() {
    return Math.ceil(currentNews().length / 3);
  }

  /** One card: the outlet, how long ago, the headline, and its photo once it has loaded. */
  function fillCard(card, item) {
    card.hidden = !item;
    if (!item) {
      return;
    }
    const minutes = Math.max(0, Math.floor((Date.now() - item.time) / 60000));
    card.querySelector('.source').textContent = item.source;
    card.querySelector('.ago').textContent = item.time ? ` · ${WORDS[lang].ago(minutes)}` : '';
    card.querySelector('.headline').textContent = item.title;
    const photo = card.querySelector('.photo');
    const show = () => card.classList.toggle('has-photo', photo.naturalWidth >= SMALLEST_PHOTO);
    photo.onload = show;
    photo.onerror = () => card.classList.remove('has-photo');
    if (!item.image) {
      photo.removeAttribute('src');
      card.classList.remove('has-photo');
    } else if (photo.getAttribute('src') === item.image && photo.complete) {
      show();
    } else {
      card.classList.remove('has-photo');
      photo.src = item.image;
    }
  }

  function fillPage(element, number) {
    const list = currentNews();
    const items = list.slice(number * 3, number * 3 + 3);
    element.querySelectorAll('.card').forEach((card, index) => fillCard(card, items[index]));
    element.querySelector('.side').hidden = items.length < 2;
  }

  function moveTo(element, x, animate) {
    element.style.transition = animate ? '' : 'none';
    element.style.transform = `translateX(${x}px)`;
  }

  function showDots() {
    const count = pageCount();
    document.querySelector('.dots').replaceChildren(
      ...Array.from({ length: count > 1 ? count : 0 }, (_, index) => {
        const dot = document.createElement('i');
        dot.className = index === page ? 'on' : '';
        return dot;
      }),
    );
  }

  /** The waiting page gets the next headlines, so its photos load before it slides in. */
  function prepareNext() {
    const count = pageCount();
    const back = pages[1 - front];
    moveTo(back, SLIDE_PX, false);
    if (count > 1) {
      fillPage(back, (page + 1) % count);
    }
  }

  /** At once, no sliding: the first page (new headlines, or the news appearing). */
  function showFirstPage() {
    page = 0;
    fillPage(pages[front], 0);
    moveTo(pages[front], 0, false);
    prepareNext();
    showDots();
  }

  function nextPage() {
    clearTimeout(pageTimer);
    pageTimer = setTimeout(nextPage, PAGE_MS);
    const count = pageCount();
    if (count === 0 || body.dataset.layout !== 'news' || state === 'ready') {
      return;
    }
    if (count === 1) {
      // One page: its times still move on.
      fillPage(pages[front], 0);
      return;
    }
    const incoming = pages[1 - front];
    const outgoing = pages[front];
    page = (page + 1) % count;
    // Filled already (prepareNext); again in case the headlines' times moved on.
    fillPage(incoming, page);
    moveTo(incoming, SLIDE_PX, false);
    // The browser takes the starting place in before the slide begins.
    void incoming.offsetWidth;
    moveTo(incoming, 0, true);
    moveTo(outgoing, -SLIDE_PX, true);
    front = 1 - front;
    showDots();
    // Once the old page is off screen, it waits on the right with the page after.
    setTimeout(prepareNext, 1000);
  }

  /** A photo's address from the phone: on the web (the sample's own drawings too, in a browser). */
  function photoUrl(value, sample) {
    if (typeof value !== 'string') {
      return '';
    }
    if (sample && value.startsWith('data:image/')) {
      return value;
    }
    return /^https?:\/\//i.test(value) && value.length <= 600 ? value : '';
  }

  /** The phone's news: the headlines (none: no news on the TV) and ReTune's language. */
  function onNews(data, sample = false) {
    if (data.lang === 'el' || data.lang === 'en') {
      lang = data.lang;
    }
    headlines = (Array.isArray(data.headlines) ? data.headlines : [])
      .filter(item => item && typeof item.title === 'string' && typeof item.source === 'string')
      .slice(0, MOST_HEADLINES)
      .map(item => ({
        source: item.source.slice(0, 40),
        title: item.title.slice(0, 240),
        time: Number(item.time) || 0,
        image: photoUrl(item.image, sample),
      }));
    showFirstPage();
    render();
    // A full stay for the first page.
    clearTimeout(pageTimer);
    pageTimer = setTimeout(nextPage, PAGE_MS);
  }

  // ---- Google Cast ----

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

  // ---- In a browser: a sample of each screen, to look at the design ----

  /** A made-up "photo" (sky, sun, hills) for the sample cards. */
  function samplePhoto(sky, ground) {
    const svg =
      "<svg xmlns='http://www.w3.org/2000/svg' width='1600' height='900'>" +
      `<defs><linearGradient id='s' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='${sky}'/>` +
      "<stop offset='1' stop-color='#f3d9a4'/></linearGradient></defs>" +
      "<rect width='1600' height='900' fill='url(#s)'/><circle cx='1150' cy='300' r='130' fill='#fff4d6'/>" +
      `<path d='M0 620 Q400 470 800 600 T1600 560 V900 H0 Z' fill='${ground}'/></svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }

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
      const photos = [
        samplePhoto('#5b8fb9', '#3f6b4a'),
        samplePhoto('#8a6fb0', '#5b4a3a'),
        samplePhoto('#3e7fa6', '#2f5a6b'),
        '',
        samplePhoto('#c27a5a', '#6b4a2f'),
        '',
      ];
      onNews({
        type: 'news',
        lang,
        headlines: [5, 18, 32, 47, 61, 90].map((minutes, index) => ({
          source: 'ReTune',
          title: greek
            ? `Δείγμα τίτλου ${index + 1}: εδώ φαίνονται οι τελευταίες ειδήσεις, σε μεγάλες κάρτες`
            : `Sample headline ${index + 1}: the latest news shows here, in big cards`,
          time: now - minutes * 60000,
          image: photos[index],
        })),
      }, true);
    }
    state = demo === 'news' ? 'playing' : ['playing', 'tuning', 'paused', 'ready'].includes(demo) ? demo : 'playing';
    render();
  }

  fit();
  addEventListener('resize', fit);
  if (window.visualViewport) {
    visualViewport.addEventListener('resize', fit);
  }
  if (window.ResizeObserver) {
    new ResizeObserver(fit).observe(document.documentElement);
  }
  setInterval(fit, 2000);
  setInterval(drift, DRIFT_MS);
  setInterval(clock, 10000);
  render();

  if (new URLSearchParams(location.search).has('demo') || typeof cast === 'undefined') {
    startDemo();
  } else {
    startCast();
  }
})();
