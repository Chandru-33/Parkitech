document.addEventListener('DOMContentLoaded', () => {
  const mapContainer = document.getElementById('search-map');
  const useLocationBtn = document.querySelector('.use-location-btn');
  const cards = document.querySelectorAll('.parking-card');
  const modal = document.getElementById('parking-modal');
  const form = document.getElementById('parking-search-form');
  const sortPills = document.querySelectorAll('.sort-pill');
  const sortInput = document.getElementById('sort');
  const userLatInput = document.getElementById('user_lat');
  const userLngInput = document.getElementById('user_lng');
  const searchButton = document.querySelector('.search-submit');
  const searchLabel = document.querySelector('.search-submit-label');
  const searchLoading = document.querySelector('.search-submit-loading');
  const locationInput = document.getElementById('location');

  function renderMap(lat, lng) {
    if (!mapContainer) return;
    const iframe = document.createElement('iframe');
    iframe.width = '100%';
    iframe.height = '160';
    iframe.style.border = '0';
    iframe.loading = 'lazy';
    iframe.referrerPolicy = 'no-referrer-when-downgrade';
    iframe.src = `https://www.google.com/maps?q=${lat},${lng}&z=14&output=embed`;
    mapContainer.innerHTML = '';
    mapContainer.appendChild(iframe);
  }

  function setSearching(isSearching) {
    if (!searchButton || !searchLabel || !searchLoading) return;
    if (isSearching) {
      searchButton.disabled = true;
      searchButton.classList.add('is-loading');
      searchLoading.style.display = 'inline';
      searchLabel.style.display = 'none';
    } else {
      searchButton.disabled = false;
      searchButton.classList.remove('is-loading');
      searchLoading.style.display = 'none';
      searchLabel.style.display = 'inline';
    }
  }

  let geoAttempted = false;

  if (form && navigator.geolocation) {
    form.addEventListener('submit', (e) => {
      if (geoAttempted) return;
      e.preventDefault();
      setSearching(true);

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords;
          if (userLatInput && userLngInput) {
            userLatInput.value = String(latitude);
            userLngInput.value = String(longitude);
          }
          renderMap(latitude, longitude);
          geoAttempted = true;
          setSearching(false);
          form.submit();
        },
        () => {
          geoAttempted = true;
          setSearching(false);
          if (locationInput) {
            locationInput.placeholder = 'Enter your location / landmark in Chennai';
          }
          form.submit();
        },
        { enableHighAccuracy: true, timeout: 8000 }
      );
    });
  }

  if (useLocationBtn && navigator.geolocation) {
    useLocationBtn.addEventListener('click', () => {
      useLocationBtn.disabled = true;
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords;
          if (userLatInput && userLngInput) {
            userLatInput.value = String(latitude);
            userLngInput.value = String(longitude);
          }
          renderMap(latitude, longitude);
          useLocationBtn.disabled = false;
        },
        () => {
          useLocationBtn.disabled = false;
          if (locationInput) {
            locationInput.placeholder = 'Enter your location / landmark in Chennai';
          }
        },
        { enableHighAccuracy: true, timeout: 8000 }
      );
    });
  }

  if (sortPills && sortInput && form) {
    sortPills.forEach((pill) => {
      pill.addEventListener('click', () => {
        const value = pill.getAttribute('data-sort');
        if (!value) return;
        sortInput.value = value;
        geoAttempted = true;
        form.submit();
      });
    });
  }

  // Parking card detail modal
  if (cards.length && modal) {
    const backdrop = modal.querySelector('.parking-modal-backdrop');
    const closeBtn = modal.querySelector('.modal-close-btn');

    function openModal(card) {
      modal.querySelector('#modal-title').textContent = card.dataset.title || '';
      modal.querySelector('#modal-address').textContent = card.dataset.address || '';
      modal.querySelector('#modal-owner').textContent = card.dataset.owner || '';
      modal.querySelector('#modal-location').textContent = card.dataset.location || '';
      modal.querySelector('#modal-vehicle').textContent = card.dataset.vehicle || '';
      modal.querySelector('#modal-slots').textContent = card.dataset.slots || '';
      modal.querySelector('#modal-available').textContent = card.dataset.available || '';
      modal.querySelector('#modal-price').textContent = card.dataset.price || '';
      modal.setAttribute('aria-hidden', 'false');
      modal.classList.add('open');
    }

    function closeModal() {
      modal.setAttribute('aria-hidden', 'true');
      modal.classList.remove('open');
    }

    cards.forEach((card) => {
      const detailsBtn = card.querySelector('.more-details-btn');
      if (detailsBtn) detailsBtn.addEventListener('click', () => openModal(card));
      card.addEventListener('click', (e) => {
        if (e.target.closest('a,button')) return;
        openModal(card);
      });
    });

    if (backdrop) backdrop.addEventListener('click', closeModal);
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal.classList.contains('open')) closeModal();
    });
  }

  // Owner dashboard earnings chart
  const chartCanvas = document.getElementById('earnings-chart');
  if (chartCanvas) {
    const labels = JSON.parse(chartCanvas.dataset.labels || '[]');
    const values = JSON.parse(chartCanvas.dataset.values || '[]');
    if (labels.length > 0) {
      drawBarChart(chartCanvas, labels, values);
    }
  }

  function drawBarChart(canvas, labels, values) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    const pad = { top: 20, right: 16, bottom: 40, left: 56 };
    const chartW = W - pad.left - pad.right;
    const chartH = H - pad.top - pad.bottom;
    const maxVal = Math.max(...values, 1);
    const barCount = labels.length;
    const gap = 8;
    const barW = Math.max(12, (chartW - gap * (barCount + 1)) / barCount);

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#f9fafb';
    ctx.fillRect(0, 0, W, H);

    // Grid lines
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + (chartH / 4) * i;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(W - pad.right, y);
      ctx.stroke();

      ctx.fillStyle = '#9ca3af';
      ctx.font = '11px system-ui';
      ctx.textAlign = 'right';
      const label = Math.round(maxVal - (maxVal / 4) * i);
      ctx.fillText('₹' + label, pad.left - 6, y + 4);
    }

    // Bars
    values.forEach((val, i) => {
      const barH = (val / maxVal) * chartH;
      const x = pad.left + gap + i * (barW + gap);
      const y = pad.top + chartH - barH;

      ctx.fillStyle = '#111827';
      ctx.beginPath();
      ctx.roundRect(x, y, barW, barH, [4, 4, 0, 0]);
      ctx.fill();

      // Label
      ctx.fillStyle = '#6b7280';
      ctx.font = '10px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(labels[i], x + barW / 2, H - pad.bottom + 16);
    });
  }

  // =========================
  // Chatbot assistant
  // =========================
  const chatbotPanel = document.getElementById('chatbot-panel');
  const chatbotFab = document.getElementById('chatbot-fab');
  const messagesEl = document.getElementById('chatbot-messages');
  const quickRepliesEl = document.getElementById('chatbot-quick-replies');
  const chatbotForm = document.getElementById('chatbot-form');
  const chatbotInput = document.getElementById('chatbot-input');

  if (chatbotFab && chatbotPanel) {
    chatbotFab.addEventListener('click', () => {
      chatbotPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  if (chatbotPanel && messagesEl && chatbotForm && chatbotInput) {
    let chatbotState = {
      step: 'idle', // idle | awaiting_location | awaiting_time | confirm
      selectedSpace: null,
      pendingTime: null,
    };

    function appendMessage(role, text) {
      const bubble = document.createElement('div');
      bubble.className = `chatbot-bubble ${role}`;
      bubble.innerHTML = text;
      messagesEl.appendChild(bubble);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function setQuickReplies(buttons) {
      quickRepliesEl.innerHTML = '';
      (buttons || []).forEach((btn) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = btn.label;
        b.dataset.value = btn.value;
        b.addEventListener('click', () => btn.onClick(btn.value));
        quickRepliesEl.appendChild(b);
      });
    }

    async function fetchJSON(url, options) {
      const res = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        ...options,
      });
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      return res.json();
    }

    async function startBookingFlow() {
      appendMessage('bot', 'Sure! Please select a location.');
      try {
        const data = await fetchJSON('/chatbot/get-locations');
        if (!data.locations || !data.locations.length) {
          appendMessage('bot', 'No available locations at the moment. Try changing your search.');
          setQuickReplies([]);
          return;
        }
        setQuickReplies(
          data.locations.slice(0, 6).map((loc) => ({
            label: loc.title,
            value: String(loc.id),
            onClick: (id) => onLocationSelected(data.locations.find((l) => String(l.id) === id)),
          }))
        );
        chatbotState.step = 'awaiting_location';
      } catch (e) {
        console.error(e);
        appendMessage('bot', 'I could not fetch locations right now. Please try again.');
        setQuickReplies([]);
      }
    }

    function onLocationSelected(space) {
      if (!space) return;
      chatbotState.selectedSpace = space;
      appendMessage('user', space.title);
      appendMessage(
        'bot',
        `Great! You selected <strong>${space.title}</strong> at ${space.address}.<br/>` +
          'Please choose your parking time:'
      );
      setQuickReplies([
        { label: '30 min', value: '30', onClick: (v) => onDurationSelected(v) },
        { label: '1 hour', value: '60', onClick: (v) => onDurationSelected(v) },
        { label: '2 hours', value: '120', onClick: (v) => onDurationSelected(v) },
      ]);
      chatbotState.step = 'awaiting_time';
    }

    async function onDurationSelected(minutesStr) {
      const minutes = parseInt(minutesStr, 10) || 60;
      chatbotState.pendingTime = { durationMinutes: minutes };
      appendMessage('user', `${minutes} minutes`);

      const now = new Date();
      const startISO = now.toISOString().slice(0, 16); // yyyy-MM-ddTHH:mm

      try {
        const data = await fetchJSON('/chatbot/check-availability', {
          method: 'POST',
          body: JSON.stringify({
            spaceId: chatbotState.selectedSpace.id,
            start_time: startISO,
            duration_minutes: minutes,
          }),
        });

        if (!data.available) {
          appendMessage('bot', data.message || 'That slot is not available for the requested time.');
          setQuickReplies([]);
          chatbotState = { step: 'idle', selectedSpace: null, pendingTime: null };
          return;
        }

        chatbotState.pendingTime.start_time = data.start_time;
        chatbotState.pendingTime.end_time = data.end_time;
        chatbotState.pendingTime.amount = data.amount;

        appendMessage(
          'bot',
          `I found an available slot at <strong>${data.space.title}</strong>.<br/>` +
            `Time: ${data.human_start} for ${data.human_duration}.<br/>` +
            `Price: <strong>₹${data.amount.toFixed(2)}</strong>.<br/>` +
            'Confirm booking?'
        );

        setQuickReplies([
          { label: 'Confirm', value: 'confirm', onClick: () => confirmBooking() },
          { label: 'Cancel', value: 'cancel', onClick: () => cancelFlow() },
        ]);
        chatbotState.step = 'confirm';
      } catch (e) {
        console.error(e);
        appendMessage('bot', 'I had trouble checking availability. Please try again.');
        setQuickReplies([]);
        chatbotState = { step: 'idle', selectedSpace: null, pendingTime: null };
      }
    }

    async function confirmBooking() {
      appendMessage('user', 'Confirm');
      try {
        const data = await fetchJSON('/chatbot/book-slot', {
          method: 'POST',
          body: JSON.stringify({
            spaceId: chatbotState.selectedSpace.id,
            start_time: chatbotState.pendingTime.start_time,
            end_time: chatbotState.pendingTime.end_time,
            duration_minutes: chatbotState.pendingTime.durationMinutes,
          }),
        });
        if (!data.success) {
          appendMessage('bot', data.message || 'Booking failed. Please try again.');
          setQuickReplies([]);
          chatbotState = { step: 'idle', selectedSpace: null, pendingTime: null };
          return;
        }

        appendMessage(
          'bot',
          `Booking confirmed! Booking ID: <strong>${data.booking.id}</strong>.<br/>` +
            `₹${data.booking.amount.toFixed(2)} paid.`
        );
        appendMessage(
          'bot',
          'You can see this booking in your history. You can also cancel it from the bookings page.'
        );
        setQuickReplies([
          {
            label: 'Download receipt',
            value: 'receipt',
            onClick: () => downloadReceipt(data.booking.id),
          },
        ]);
        chatbotState = { step: 'idle', selectedSpace: null, pendingTime: null };
      } catch (e) {
        console.error(e);
        appendMessage('bot', 'Something went wrong while creating your booking. Please try again.');
        setQuickReplies([]);
        chatbotState = { step: 'idle', selectedSpace: null, pendingTime: null };
      }
    }

    async function downloadReceipt(bookingId) {
      try {
        const data = await fetchJSON(`/chatbot/generate-receipt?bookingId=${encodeURIComponent(bookingId)}`);
        const w = window.open('', '_blank');
        if (!w) return;
        w.document.write(data.html || '<p>Receipt unavailable.</p>');
        w.document.close();
      } catch (e) {
        console.error(e);
        appendMessage('bot', 'Could not generate receipt. Please try again from your bookings page.');
      }
    }

    function cancelFlow() {
      appendMessage('user', 'Cancel');
      appendMessage('bot', 'Okay, cancelled this booking flow. You can type “Book a slot” to start again.');
      setQuickReplies([]);
      chatbotState = { step: 'idle', selectedSpace: null, pendingTime: null };
    }

    function handleKnowledgeQuestion(text) {
      const lower = text.toLowerCase();
      if (lower.includes('nearest') || lower.includes('near')) {
        appendMessage(
          'bot',
          'Use the Location field and enable your device location to find parking closest to you.'
        );
      } else if (lower.includes('price')) {
        appendMessage(
          'bot',
          'Prices vary per location. I will show you an exact price when you pick a parking space and time.'
        );
      } else if (lower.includes('how long') || lower.includes('duration')) {
        appendMessage('bot', 'You can usually park from 30 minutes up to several hours, depending on availability.');
      } else if (lower.includes('cancel')) {
        appendMessage(
          'bot',
          'You can cancel a booking from the “My bookings” page as long as the start time has not passed.'
        );
      } else {
        appendMessage(
          'bot',
          "I'm here to help you search for parking and book a slot, and to answer basic questions about SmartPark."
        );
      }
    }

    chatbotForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = chatbotInput.value.trim();
      if (!text) return;
      appendMessage('user', text);
      chatbotInput.value = '';

      if (text.toLowerCase().includes('book a slot')) {
        chatbotState = { step: 'idle', selectedSpace: null, pendingTime: null };
        startBookingFlow();
        return;
      }

      if (chatbotState.step === 'awaiting_location') {
        appendMessage('bot', 'Please tap one of the location buttons I showed you.');
        return;
      }
      if (chatbotState.step === 'awaiting_time') {
        appendMessage('bot', 'Use the duration buttons to choose your parking time.');
        return;
      }
      if (chatbotState.step === 'confirm') {
        appendMessage('bot', 'Tap Confirm or Cancel to continue.');
        return;
      }

      handleKnowledgeQuestion(text);
    });
  }
});
