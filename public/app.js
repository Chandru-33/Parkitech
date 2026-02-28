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
});
