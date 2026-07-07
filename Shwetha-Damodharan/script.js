(function () {
      const body = document.body;
      const stage = document.querySelector('.stage');
      const video = document.getElementById('inviteVideo');
      const audio = document.getElementById('bgMusic');
      const overlay = document.getElementById('textOverlay');
      const tapLayer = document.getElementById('tapLayer');
      const endFallback = document.getElementById('endFallback');
      const scrollCue = document.getElementById('scrollCue');
      const contentRoot = document.getElementById('contentRoot');
      const animItems = Array.from(document.querySelectorAll('.anim-item'));
      const panelImages = Array.from(document.querySelectorAll('.panel-image'));
      const criticalPanelImages = panelImages.slice(0, 2);
      const rsvpSection = document.querySelector('.rsvp-section');
      const sequence = [
        { id:'name1', text:'Shwetha', speed:70, pauseAfter:180 },
        { id:'ampersand', text:'&', speed:180, pauseAfter:120 },
        { id:'name2', text:'Damodharan', speed:68, pauseAfter:260 },
        { id:'inviteLine1', text:'JOYFULLY INVITE YOU TO THEIR', speed:22, pauseAfter:120 },
        { id:'inviteLine2', text:'WEDDING CEREMONY', speed:38, pauseAfter:220 },
        { id:'dateDay', text:'23', speed:180, pauseAfter:40 },
        { id:'dateMonth', text:'AUGUST', speed:38, pauseAfter:80 },
        { id:'dateWeekday', text:'SUNDAY', speed:34, pauseAfter:60 },
        { id:'dateYear', text:'2026', speed:120, pauseAfter:200 }
      ];
      let hasPlayed = false;
      let endedState = false;
      let typingStarted = false;
      let contentShown = false;
      const audioStartTime = 13;
      const audioUrl = 'https://res.cloudinary.com/dx3f65i2v/video/upload/v1783382418/Adiga_tjwghg.mp3';
      const storagePrefix = 'shwetha_damodharan_invitation_v3';
      const audioTimeKey = storagePrefix + '_audio_time';
      const videoTimeKey = storagePrefix + '_video_time';
      const startedKey = storagePrefix + '_started';
      let resumeOnVisible = false;
      let resumeAttemptQueued = false;
      let pendingAudioRetryTimer = null;
      let preferWebAudio = false;
      let audioContext = null;
      let audioGain = null;
      let audioBuffer = null;
      let audioBytesPromise = null;
      let audioBufferPromise = null;
      let webAudioSource = null;
      let webAudioOffset = audioStartTime;
      let webAudioStartedAt = 0;
      let usingWebAudio = false;
      audio.volume = 1;
      audio.muted = false;
      audio.defaultMuted = false;
      audio.loop = true;
      audio.playsInline = true;
      try { audio.setAttribute('playsinline', ''); audio.setAttribute('webkit-playsinline', ''); } catch (e) {}
      video.muted = true;
      video.defaultMuted = true;
      video.volume = 0;

      function safeStorageGet(key) {
        try { return window.sessionStorage.getItem(key); } catch (e) { return null; }
      }

      function safeStorageSet(key, value) {
        try { window.sessionStorage.setItem(key, String(value)); } catch (e) {}
      }

      function getSavedNumber(key, fallback) {
        const raw = safeStorageGet(key);
        const value = raw === null ? NaN : Number(raw);
        return Number.isFinite(value) ? value : fallback;
      }

      function getWebAudioCurrentTime() {
        if (!audioBuffer) return Math.max(audioStartTime, webAudioOffset || audioStartTime);
        const duration = audioBuffer.duration || 0;
        if (!duration) return Math.max(audioStartTime, webAudioOffset || audioStartTime);
        if (usingWebAudio && audioContext && audioContext.state === 'running') {
          const elapsed = Math.max(0, audioContext.currentTime - webAudioStartedAt);
          return ((webAudioOffset + elapsed) % duration) || audioStartTime;
        }
        return ((webAudioOffset || audioStartTime) % duration) || audioStartTime;
      }

      function persistPlaybackState() {
        if (usingWebAudio) {
          safeStorageSet(audioTimeKey, Math.max(audioStartTime, getWebAudioCurrentTime()).toFixed(3));
        } else if (!audio.paused && Number.isFinite(audio.currentTime) && audio.currentTime > 0) {
          safeStorageSet(audioTimeKey, Math.max(audioStartTime, audio.currentTime).toFixed(3));
        }
        if (!video.paused && Number.isFinite(video.currentTime) && video.currentTime > 0) {
          safeStorageSet(videoTimeKey, video.currentTime.toFixed(3));
        }
        if (hasPlayed) safeStorageSet(startedKey, '1');
      }

      function clearPendingAudioRetry() {
        if (!pendingAudioRetryTimer) return;
        clearTimeout(pendingAudioRetryTimer);
        pendingAudioRetryTimer = null;
      }

      function getTargetAudioTime(forceFromStart) {
        if (forceFromStart) return audioStartTime;
        return Math.max(audioStartTime, getSavedNumber(audioTimeKey, audioStartTime));
      }

      function getTargetVideoTime() {
        return Math.max(0, getSavedNumber(videoTimeKey, 0));
      }

      function ensureAudioContext() {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return null;
        if (!audioContext) {
          audioContext = new Ctx();
          audioGain = audioContext.createGain();
          audioGain.gain.value = 1;
          audioGain.connect(audioContext.destination);
        }
        return audioContext;
      }

      function preloadAudioBytes() {
        if (!audioBytesPromise) {
          audioBytesPromise = fetch(audioUrl, { mode:'cors', cache:'force-cache' }).then(function (response) {
            if (!response.ok) throw new Error('Audio fetch failed');
            return response.arrayBuffer();
          });
        }
        return audioBytesPromise;
      }

      function ensureDecodedAudioBuffer() {
        const ctx = ensureAudioContext();
        if (!ctx) return Promise.reject(new Error('Web Audio API unavailable'));
        if (audioBuffer) return Promise.resolve(audioBuffer);
        if (!audioBufferPromise) {
          audioBufferPromise = preloadAudioBytes().then(function (bytes) {
            return ctx.decodeAudioData(bytes.slice(0));
          }).then(function (buffer) {
            audioBuffer = buffer;
            return buffer;
          });
        }
        return audioBufferPromise;
      }

      function stopWebAudio(preservePosition) {
        if (preservePosition) webAudioOffset = getWebAudioCurrentTime();
        if (webAudioSource) {
          try { webAudioSource.stop(0); } catch (e) {}
          try { webAudioSource.disconnect(); } catch (e) {}
          webAudioSource = null;
        }
        usingWebAudio = false;
      }

      async function startWebAudioAt(offsetSeconds) {
        const ctx = ensureAudioContext();
        if (!ctx) throw new Error('Web Audio API unavailable');
        await ensureDecodedAudioBuffer();
        if (ctx.state === 'suspended') await ctx.resume();
        stopWebAudio(false);
        const duration = audioBuffer.duration || 0;
        const normalized = duration ? (((offsetSeconds || audioStartTime) % duration) + duration) % duration : Math.max(audioStartTime, offsetSeconds || audioStartTime);
        webAudioSource = ctx.createBufferSource();
        webAudioSource.buffer = audioBuffer;
        webAudioSource.loop = true;
        webAudioSource.connect(audioGain);
        webAudioOffset = normalized;
        webAudioStartedAt = ctx.currentTime;
        usingWebAudio = true;
        try { audio.pause(); } catch (e) {}
        webAudioSource.start(0, normalized);
        safeStorageSet(audioTimeKey, Math.max(audioStartTime, normalized).toFixed(3));
      }
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('in');
            observer.unobserve(entry.target);
          }
        });
      }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });

      const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
      const afterNextPaint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const requestIdle = (fn) => {
        if ('requestIdleCallback' in window) window.requestIdleCallback(fn, { timeout: 1200 });
        else setTimeout(fn, 220);
      };

      function stopMedia() {
        persistPlaybackState();
        resumeOnVisible = hasPlayed;
        clearPendingAudioRetry();
        stopWebAudio(true);
        if (audioContext && audioContext.state === 'running') {
          audioContext.suspend().catch(function () {});
        }
        try { audio.pause(); } catch (e) {}
        try { video.pause(); } catch (e) {}
      }

      function revealContent() {
        if (contentShown) return;
        contentShown = true;
        contentRoot.classList.add('visible');
        body.classList.remove('locked');
        animItems.forEach(item => observer.observe(item));
      }

      function showFallbackFrame() {
        stage.classList.add('media-ended');
        endFallback.style.opacity = '1';
      }

      function resetHeroState() {
        stage.classList.remove('media-ended');
        endFallback.style.opacity = '0';
        video.style.opacity = '1';
      }

      function restoreHeroIdleState() {
        if (endedState || contentShown) return;
        resetHeroState();
        overlay.classList.remove('active');
        scrollCue.classList.remove('visible');
        clearText();
        tapLayer.style.display = 'block';
        const resetToDoorStart = function () {
          try { video.currentTime = 0; } catch (e) {}
        };
        if (video.readyState >= 1) resetToDoorStart();
        else video.addEventListener('loadedmetadata', resetToDoorStart, { once:true });
      }

      function clearText() {
        sequence.forEach(item => {
          const el = document.getElementById(item.id);
          if (el) el.textContent = '';
        });
      }

      function typeText(el, text, speed) {
        return new Promise(resolve => {
          let i = 0;
          function step() {
            el.textContent = text.slice(0, i);
            if (i <= text.length) {
              i += 1;
              setTimeout(step, speed);
            } else {
              resolve();
            }
          }
          step();
        });
      }

      function preloadImage(img, highPriority) {
        return new Promise(resolve => {
          if (!img) return resolve();
          try {
            img.loading = 'eager';
            img.decoding = 'async';
            if ('fetchPriority' in img && highPriority) img.fetchPriority = 'high';
          } catch (e) {}
          const done = () => {
            if (typeof img.decode === 'function') img.decode().catch(() => {}).finally(resolve);
            else resolve();
          };
          if (img.complete && img.naturalWidth > 0) return done();
          const loader = new Image();
          loader.decoding = 'async';
          loader.onload = done;
          loader.onerror = resolve;
          loader.src = img.currentSrc || img.src;
        });
      }

      function warmRsvpBackground() {
        if (!rsvpSection) return;
        const bg = getComputedStyle(rsvpSection).backgroundImage || '';
        const match = /url\((?:"|')?(.*?)(?:"|')?\)/.exec(bg);
        if (!match || !match[1]) return;
        const img = new Image();
        img.decoding = 'async';
        img.src = match[1];
      }

      function primeUpcomingMedia() {
        criticalPanelImages.forEach((img, index) => { preloadImage(img, index === 0); });
        warmRsvpBackground();
        requestIdle(() => panelImages.slice(2).forEach(img => preloadImage(img, false)));
      }

      async function runSequence() {
        if (typingStarted) return;
        typingStarted = true;
        clearText();
        overlay.classList.add('active');
        for (const item of sequence) {
          const el = document.getElementById(item.id);
          await typeText(el, item.text, item.speed);
          if (item.pauseAfter) await wait(item.pauseAfter);
        }
        scrollCue.classList.add('visible');
        revealContent();
      }

      async function finishSequence() {
        if (endedState) return;
        endedState = true;
        tapLayer.style.display = 'none';
        try { video.pause(); } catch (e) {}
        showFallbackFrame();
        await Promise.race([
          Promise.allSettled(criticalPanelImages.map((img, index) => preloadImage(img, index === 0))),
          wait(900)
        ]);
        await afterNextPaint();
        await runSequence();
      }

      function waitForAudioReady() {
        if (audio.readyState >= 1) return Promise.resolve();
        return new Promise((resolve, reject) => {
          const onLoaded = () => resolve();
          const onError = () => reject(new Error('Audio failed to load'));
          audio.addEventListener('loadedmetadata', onLoaded, { once:true });
          audio.addEventListener('error', onError, { once:true });
          audio.load();
        });
      }

      function scheduleAudioRetry(forceFromStart, delays) {
        const remaining = Array.isArray(delays) ? delays.slice() : [250, 1000, 2000];
        clearPendingAudioRetry();
        if (!remaining.length) return;
        const delay = remaining.shift();
        pendingAudioRetryTimer = setTimeout(async function () {
          pendingAudioRetryTimer = null;
          if (document.hidden || !hasPlayed) return;
          try {
            await playAudioFromRequestedTime(forceFromStart, remaining, true);
          } catch (e) {
            scheduleAudioRetry(forceFromStart, remaining);
          }
        }, delay);
      }

      function beginHtmlAudioOnUserGesture(forceFromStart, retryDelays) {
        clearPendingAudioRetry();
        audio.muted = false;
        audio.defaultMuted = false;
        audio.volume = 1;
        const targetAudioTime = getTargetAudioTime(Boolean(forceFromStart));

        const syncSeekOnReady = () => {
          try {
            const wanted = getTargetAudioTime(Boolean(forceFromStart));
            if (Math.abs(audio.currentTime - wanted) > 0.25) audio.currentTime = wanted;
          } catch (e) {}
        };

        try {
          if (audio.readyState >= 1 && Math.abs(audio.currentTime - targetAudioTime) > 0.25) {
            audio.currentTime = targetAudioTime;
          }
        } catch (e) {}

        audio.addEventListener('loadedmetadata', syncSeekOnReady, { once:true });
        audio.addEventListener('canplay', syncSeekOnReady, { once:true });
        try { audio.load(); } catch (e) {}

        const playResult = audio.play();
        if (playResult && typeof playResult.catch === 'function') {
          playResult.catch(function () {
            scheduleAudioRetry(forceFromStart, retryDelays);
          });
        }

        setTimeout(function () {
          syncSeekOnReady();
          if (audio.paused) scheduleAudioRetry(forceFromStart, retryDelays);
        }, 120);

        return playResult || Promise.resolve();
      }

      async function playAudioFromRequestedTime(forceFromStart, retryDelays, fromRetry) {
        if (!fromRetry) clearPendingAudioRetry();
        const targetTime = getTargetAudioTime(Boolean(forceFromStart));

        if (!preferWebAudio) {
          const htmlPlay = beginHtmlAudioOnUserGesture(forceFromStart, retryDelays);
          await waitForAudioReady().catch(function () {});
          if (htmlPlay && typeof htmlPlay.then === 'function') await htmlPlay.catch(function () {});
          await wait(160);
          try {
            if (!audio.paused) {
              safeStorageSet(audioTimeKey, Math.max(audioStartTime, audio.currentTime || targetTime).toFixed(3));
              return;
            }
          } catch (e) {}
          preferWebAudio = true;
        }

        await startWebAudioAt(targetTime);
        safeStorageSet(audioTimeKey, Math.max(audioStartTime, getWebAudioCurrentTime()).toFixed(3));
      }

      async function resumeMediaIfNeeded() {
        if (!resumeOnVisible || document.hidden) return;
        resumeOnVisible = false;
        try {
          hasPlayed = true;
          restoreHeroIdleState();
          await playAudioFromRequestedTime(false, [300, 1000, 2200]);
        } catch (e) {
          queueResumeAttempt();
        }
      }

      function queueResumeAttempt() {
        if (resumeAttemptQueued) return;
        resumeAttemptQueued = true;
        const tryResume = () => {
          resumeAttemptQueued = false;
          resumeMediaIfNeeded();
        };
        window.addEventListener('pointerdown', tryResume, { once:true, passive:true });
        window.addEventListener('touchstart', tryResume, { once:true, passive:true });
        window.addEventListener('click', tryResume, { once:true, passive:true });
      }

      async function startExperience() {
        if (!video.paused && !endedState) return;
        hasPlayed = true;
        resumeOnVisible = false;
        safeStorageSet(startedKey, '1');
        tapLayer.style.display = 'none';
        resetHeroState();
        overlay.classList.remove('active');
        clearText();
        primeUpcomingMedia();
        try {
          ensureAudioContext();
          preloadAudioBytes();
          video.muted = true;
          video.defaultMuted = true;
          video.volume = 0;
          const savedVideoTime = getTargetVideoTime();
          if (savedVideoTime > 0 && savedVideoTime < Math.max(0, (video.duration || Infinity) - 0.25)) {
            try { video.currentTime = savedVideoTime; } catch (e) {}
          }
       const audioPlay = playAudioFromRequestedTime(false,[300,1000,2200]);

try{
    await video.play();
}catch(e){
    console.error("Video play failed",e);
}

await audioPlay.catch(()=>{})
        } catch (err) {  
          hasPlayed = false;
          tapLayer.style.display = 'block';
          stopMedia();
          showFallbackFrame();
        }
      }

      tapLayer.addEventListener('click', startExperience, { passive:true });
      audio.addEventListener('timeupdate', function () { if (!usingWebAudio) persistPlaybackState(); }, { passive:true });
      audio.addEventListener('play', function () { clearPendingAudioRetry(); usingWebAudio = false; persistPlaybackState(); }, { passive:true });
      audio.addEventListener('pause', function () { if (!usingWebAudio) persistPlaybackState(); }, { passive:true });
      audio.addEventListener('ended', function () { if (!usingWebAudio) persistPlaybackState(); }, { passive:true });
      video.addEventListener('timeupdate', persistPlaybackState, { passive:true });
      video.addEventListener('pause', persistPlaybackState, { passive:true });
      video.addEventListener('playing', function () {
        resetHeroState();
        persistPlaybackState();
      });
      video.addEventListener('canplay', primeUpcomingMedia, { once:true });
      video.addEventListener('loadedmetadata', function () {
        const savedVideoTime = getTargetVideoTime();
        if (savedVideoTime > 0 && savedVideoTime < Math.max(0, (video.duration || Infinity) - 0.25)) {
          try { video.currentTime = savedVideoTime; } catch (e) {}
        }
      }, { once:true });
      video.addEventListener('ended', function () {
        safeStorageSet(videoTimeKey, '0');
        finishSequence();
      });
      video.addEventListener('error', function () {
        showFallbackFrame();
      });
      window.addEventListener('load', function () {
        requestIdle(function () {
          primeUpcomingMedia();
          preloadAudioBytes();
        });
        if (safeStorageGet(startedKey) === '1') {
          hasPlayed = true;
          resumeOnVisible = true;
          restoreHeroIdleState();
        }
      }, { once:true });
      window.addEventListener('pagehide', stopMedia);
      window.addEventListener('beforeunload', stopMedia);
      window.addEventListener('pageshow', function () { if (hasPlayed || safeStorageGet(startedKey) === '1') { restoreHeroIdleState(); resumeMediaIfNeeded(); } });
      window.addEventListener('focus', function () { if (hasPlayed || safeStorageGet(startedKey) === '1') resumeMediaIfNeeded(); });
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) stopMedia();
        else if (hasPlayed || safeStorageGet(startedKey) === '1') resumeMediaIfNeeded();
      });
    })();

(function () {
      const form = document.getElementById('rsvpForm');
      if (!form) return;
      const endpoint = 'https://script.google.com/macros/s/AKfycbzWyG1Eg01oLC8qkvS4md5Z5nndTQjEjrK4q1x420FwFMtBMaYDZO7fz3IyD0DXvUi_/exec';
      const submitButton = document.getElementById('rsvpSubmitButton');
      const submitError = document.getElementById('submitError');
      const formScreen = document.getElementById('rsvpFormScreen');
      const confirmationScreen = document.getElementById('rsvpConfirmationScreen');
      const attendanceInputs = Array.from(form.querySelectorAll('input[name="attendanceStatus"]'));
      const dietaryInputs = Array.from(form.querySelectorAll('input[name="dietaryPreference"]'));
      const guestNameInput = document.getElementById('primaryGuestName');
      const totalGuestsInput = document.getElementById('totalGuests');
      const weddingCeremonyInput = document.getElementById('weddingCeremony');
      const receptionInput = document.getElementById('reception');
      const messageInput = document.getElementById('messageForCouple');
      let confirmationResetTimer = null;

      function getSelectedValue(name) {
        const checked = form.querySelector('input[name="' + name + '"]:checked');
        return checked ? checked.value : '';
      }

      function setError(field, message) {
        const node = form.querySelector('[data-error-for="' + field + '"]');
        if (node) node.textContent = message || '';
      }

      function clearErrors() {
        ['attendanceStatus', 'primaryGuestName', 'totalGuests', 'events', 'dietaryPreference', 'messageForCouple'].forEach(function (field) {
          setError(field, '');
        });
        submitError.textContent = '';
      }

      function toggleEventRequirement() {
        const attendance = getSelectedValue('attendanceStatus');
        const disabled = attendance === 'We are unable to attend';
        weddingCeremonyInput.disabled = disabled;
        receptionInput.disabled = disabled;
        if (disabled) {
          weddingCeremonyInput.checked = false;
          receptionInput.checked = false;
          setError('events', '');
        }
        syncSelectionStates();
      }

      function syncSelectionStates() {
        form.querySelectorAll('.radio-card, .checkbox-card').forEach(function (card) {
          const input = card.querySelector('input');
          if (!input) return;
          card.classList.toggle('is-checked', !!input.checked);
          card.classList.toggle('is-disabled', !!input.disabled);
        });
      }

      attendanceInputs.forEach(function (input) {
        input.addEventListener('change', toggleEventRequirement);
      });
      form.querySelectorAll('input[type="radio"], input[type="checkbox"]').forEach(function (input) {
        input.addEventListener('change', syncSelectionStates);
      });

      function resetRsvpFormForNextResponse() {
        if (confirmationResetTimer) {
          clearTimeout(confirmationResetTimer);
          confirmationResetTimer = null;
        }
        form.reset();
        clearErrors();
        formScreen.style.display = '';
        confirmationScreen.classList.remove('active');
        toggleEventRequirement();
        syncSelectionStates();
      }

      function validateForm() {
        clearErrors();
        let valid = true;
        const attendanceStatus = getSelectedValue('attendanceStatus');
        const primaryGuestName = guestNameInput.value.trim();
        const dietaryPreference = getSelectedValue('dietaryPreference');
        const totalGuestsRaw = totalGuestsInput.value.trim();
        const totalGuestsNumber = Number(totalGuestsRaw);

        if (!attendanceStatus) {
          setError('attendanceStatus', 'Please choose your attendance status.');
          valid = false;
        }
        if (!primaryGuestName) {
          setError('primaryGuestName', 'Please enter the primary guest name.');
          valid = false;
        }
        if (totalGuestsRaw === '' || !Number.isFinite(totalGuestsNumber) || totalGuestsNumber < 0 || !Number.isInteger(totalGuestsNumber)) {
          setError('totalGuests', 'Please enter a valid guest count.');
          valid = false;
        }
        if (attendanceStatus === "Yes, we'd love to attend" && !weddingCeremonyInput.checked && !receptionInput.checked) {
          setError('events', 'Please select at least one event you will attend.');
          valid = false;
        }
        if (!dietaryPreference) {
          setError('dietaryPreference', 'Please choose your dietary preference.');
          valid = false;
        }
        return valid;
      }

      async function submitRsvp(payload) {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(payload),
          mode: 'cors',
          redirect: 'follow',
          cache: 'no-store'
        });

        const contentType = (response.headers.get('content-type') || '').toLowerCase();
        let data = null;
        if (contentType.includes('application/json')) {
          data = await response.json();
        } else {
          const text = await response.text();
          try {
            data = JSON.parse(text);
          } catch (error) {
            data = { raw: text };
          }
        }

        if (!response.ok) {
          const message = data && (data.message || data.error) ? (data.message || data.error) : 'Unable to submit RSVP right now. Please try again.';
          throw new Error(message);
        }

        if (data && typeof data === 'object') {
          const successFlag = String(data.status || data.result || data.success || '').toLowerCase();
          if (successFlag && !['ok', 'success', 'true', 'submitted'].includes(successFlag)) {
            throw new Error(data.message || 'The RSVP service returned an unexpected response.');
          }
        }

        return data;
      }

      form.addEventListener('submit', async function (event) {
        event.preventDefault();
        toggleEventRequirement();
        if (!validateForm()) return;

        const attendanceStatus = getSelectedValue('attendanceStatus');
        const payload = {
          attendanceStatus: attendanceStatus,
          primaryGuestName: guestNameInput.value.trim(),
          totalGuests: totalGuestsInput.value.trim(),
          weddingCeremony: weddingCeremonyInput.checked ? 'Yes' : 'No',
          reception: receptionInput.checked ? 'Yes' : 'No',
          dietaryPreference: getSelectedValue('dietaryPreference'),
          messageForCouple: messageInput.value.trim()
        };

        submitButton.disabled = true;
        submitButton.classList.add('is-loading');
        submitError.textContent = '';

        try {
          await submitRsvp(payload);
          formScreen.style.display = 'none';
          confirmationScreen.classList.add('active');
          confirmationResetTimer = setTimeout(function () {
            resetRsvpFormForNextResponse();
          }, 5000);
        } catch (error) {
          const rawMessage = error && error.message ? error.message : 'Unable to submit RSVP right now. Please try again.';
          const isLikelyCors = /failed to fetch|networkerror|network request failed|load failed/i.test(rawMessage);
          submitError.textContent = isLikelyCors
            ? 'Submission could not reach the RSVP service. Please check the Apps Script web app access and CORS settings, then try again.'
            : rawMessage;
        } finally {
          submitButton.disabled = false;
          submitButton.classList.remove('is-loading');
        }
      });

      toggleEventRequirement();
      syncSelectionStates();
    })();
