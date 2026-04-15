const NEW_CATEGORY_VALUE = "__new__";
const NIZHNEUDINSK_CENTER = [54.9024925, 99.0289558];
const NIZHNEUDINSK_BOUNDS = [
  [54.8551994, 98.9290848],
  [54.968033, 99.1122392],
];

const map = L.map("map", {
  maxBounds: NIZHNEUDINSK_BOUNDS,
  maxBoundsViscosity: 0.96,
  minZoom: 11,
  zoomControl: true,
});

L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
  maxZoom: 19,
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
}).addTo(map);

map.fitBounds(NIZHNEUDINSK_BOUNDS, { padding: [16, 16] });

const form = document.getElementById("placeForm");
const latInput = document.getElementById("lat");
const lonInput = document.getElementById("lon");
const categoryIdInput = document.getElementById("categoryId");
const categoryNameInput = document.getElementById("categoryName");
const categoryColorInput = document.getElementById("categoryColor");
const newCategoryFields = document.getElementById("newCategoryFields");
const photoUrlInput = document.getElementById("photoUrl");
const photoFileInput = document.getElementById("photoFile");

const statusEl = document.getElementById("formStatus");
const pageStatusEl = document.getElementById("pageStatus");
const placesList = document.getElementById("placesList");
const placesCount = document.getElementById("placesCount");
const categoriesLegend = document.getElementById("categoriesLegend");

const addDialog = document.getElementById("addDialog");
const openAddDialogBtn = document.getElementById("openAddDialogBtn");
const cancelDialogButton = document.getElementById("cancelDialogButton");
const closeDialogButton = document.getElementById("closeDialogButton");

let selectionMarker = null;
let placesLayer = L.layerGroup().addTo(map);
let placesCache = [];
let categoriesCache = [];

map.on("click", onMapClick);

form.addEventListener("submit", onSubmit);
categoryIdInput.addEventListener("change", onCategorySelectionChange);

openAddDialogBtn.addEventListener("click", () => {
  openDialogWithLastCoordinates();
});

cancelDialogButton.addEventListener("click", closeDialog);
closeDialogButton.addEventListener("click", closeDialog);

addDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeDialog();
});

photoFileInput.addEventListener("change", () => {
  if (photoFileInput.files[0]) {
    photoUrlInput.value = "";
  }
});

init().catch((error) => {
  console.error(error);
  setPageStatus("Не удалось загрузить данные. Перезагрузите страницу.", "error");
});

async function init() {
  await Promise.all([loadCategories(), loadPlaces()]);
  if (placesCache.length === 0) {
    map.setView(NIZHNEUDINSK_CENTER, 13);
  }
}

async function loadCategories() {
  const response = await fetch("/api/categories");
  if (!response.ok) {
    throw new Error("Unable to load categories");
  }

  categoriesCache = await response.json();
  renderCategorySelect();
  renderCategoriesLegend();
}

async function loadPlaces() {
  const response = await fetch("/api/places");
  if (!response.ok) {
    throw new Error("Unable to load places");
  }

  const collection = await response.json();
  placesCache = collection.features || [];
  renderMarkers();
  renderList();
}

function renderCategorySelect() {
  categoryIdInput.innerHTML = "";

  for (const category of categoriesCache) {
    const option = document.createElement("option");
    option.value = category.id;
    option.textContent = category.name;
    categoryIdInput.appendChild(option);
  }

  const newCategoryOption = document.createElement("option");
  newCategoryOption.value = NEW_CATEGORY_VALUE;
  newCategoryOption.textContent = "+ Новая категория";
  categoryIdInput.appendChild(newCategoryOption);

  categoryIdInput.value = categoriesCache[0]?.id || NEW_CATEGORY_VALUE;
  onCategorySelectionChange();
}

function onCategorySelectionChange() {
  const isNewCategorySelected = categoryIdInput.value === NEW_CATEGORY_VALUE;
  newCategoryFields.hidden = !isNewCategorySelected;

  categoryNameInput.required = isNewCategorySelected;
  if (!isNewCategorySelected) {
    categoryNameInput.value = "";
  }
}

function renderCategoriesLegend() {
  categoriesLegend.innerHTML = "";

  for (const category of categoriesCache) {
    const item = document.createElement("span");
    item.className = "legend-item";
    item.innerHTML = `
      <span class="legend-color" style="background:${escapeHtmlAttribute(category.color)}"></span>
      <span>${escapeHtml(category.name)}</span>
    `;
    categoriesLegend.appendChild(item);
  }
}

function onMapClick(event) {
  const { lat, lng } = event.latlng;
  setSelectedCoordinates(lat, lng);
  openAddDialog();
  setStatus("Координаты выбраны. Заполните данные и сохраните.", "ok");
}

function openDialogWithLastCoordinates() {
  if (!latInput.value || !lonInput.value) {
    const center = map.getCenter();
    setSelectedCoordinates(center.lat, center.lng);
  }

  openAddDialog();
}

function openAddDialog() {
  if (typeof addDialog.showModal === "function") {
    if (!addDialog.open) {
      addDialog.showModal();
    }
  } else {
    addDialog.setAttribute("open", "true");
  }
}

function closeDialog() {
  if (!addDialog.open) {
    return;
  }

  if (typeof addDialog.close === "function") {
    addDialog.close();
  } else {
    addDialog.removeAttribute("open");
  }
}

function renderMarkers() {
  placesLayer.clearLayers();

  for (const place of placesCache) {
    const [lon, lat] = place.geometry.coordinates;
    const marker = L.marker([lat, lon], {
      title: place.properties.name,
      icon: createPinIcon(place.properties.categoryColor),
    });

    marker.bindPopup(createPopupHtml(place), {
      className: "map-popup",
      closeButton: false,
    });

    marker.bindTooltip(createHoverCardHtml(place), {
      className: "place-hover-tooltip",
      direction: "top",
      offset: [0, -26],
      opacity: 1,
      sticky: true,
    });

    marker.on("mouseover", () => {
      marker.openTooltip();
    });

    marker.on("mouseout", () => {
      marker.closeTooltip();
    });

    marker.addTo(placesLayer);
  }
}

function createPinIcon(color) {
  const safeColor = normalizeColorOrFallback(color, "#c4572e");
  return L.divIcon({
    className: "custom-pin",
    html: `
      <div class="pin-wrapper">
        <span class="pin-dot" style="background:${escapeHtmlAttribute(safeColor)}"></span>
        <span class="pin-center"></span>
      </div>
    `,
    iconSize: [28, 40],
    iconAnchor: [14, 38],
    popupAnchor: [0, -36],
    tooltipAnchor: [0, -32],
  });
}

function createPopupHtml(place) {
  const link = `/place/${encodeURIComponent(place.id)}`;
  const categoryName = place.properties.categoryName || "Без категории";
  const categoryColor = normalizeColorOrFallback(place.properties.categoryColor, "#c4572e");
  const address = place.properties.address || "Адрес уточняется";

  return `
    <div class="map-popup">
      <div class="map-popup-title">${escapeHtml(place.properties.name)}</div>
      <p class="map-popup-meta">${escapeHtml(address)}</p>
      <div class="map-popup-category">
        <span class="place-category">
          <span class="place-category-dot" style="background:${escapeHtmlAttribute(categoryColor)}"></span>
          ${escapeHtml(categoryName)}
        </span>
      </div>
      <a href="${link}">Открыть карточку</a>
    </div>
  `;
}

function createHoverCardHtml(place) {
  const categoryName = place.properties.categoryName || "Без категории";
  const categoryColor = normalizeColorOrFallback(place.properties.categoryColor, "#c4572e");
  const address = place.properties.address || "Адрес уточняется";

  return `
    <div class="hover-card">
      <p class="hover-title">${escapeHtml(place.properties.name)}</p>
      <p class="hover-address">${escapeHtml(address)}</p>
      <span class="hover-category">
        <span class="hover-dot" style="background:${escapeHtmlAttribute(categoryColor)}"></span>
        ${escapeHtml(categoryName)}
      </span>
    </div>
  `;
}

function renderList() {
  placesCount.textContent = String(placesCache.length);

  if (placesCache.length === 0) {
    placesList.innerHTML = '<p class="hint">Пока нет точек. Нажмите на карту и добавьте первую.</p>';
    setPageStatus("Список пуст", "empty");
    return;
  }

  setPageStatus("", "");
  const sorted = [...placesCache].sort((a, b) => {
    const aDate = new Date(a.properties.createdAt).getTime();
    const bDate = new Date(b.properties.createdAt).getTime();
    return bDate - aDate;
  });

  placesList.innerHTML = "";

  for (const place of sorted) {
    const wrapper = document.createElement("article");
    wrapper.className = "place-item";

    const [lon, lat] = place.geometry.coordinates;
    const detailsLink = `/place/${encodeURIComponent(place.id)}`;
    const categoryName = place.properties.categoryName || "Без категории";
    const categoryColor = normalizeColorOrFallback(place.properties.categoryColor, "#c4572e");
    const safeId = escapeHtmlAttribute(place.id);

    wrapper.innerHTML = `
      <p class="place-item-title">${escapeHtml(place.properties.name)}</p>
      <span class="place-category">
        <span class="place-category-dot" style="background:${escapeHtmlAttribute(categoryColor)}"></span>
        ${escapeHtml(categoryName)}
      </span>
      <p class="place-item-meta">${escapeHtml(place.properties.address || "Адрес уточняется")}</p>
      <p class="place-item-meta">Координаты: ${lat.toFixed(6)}, ${lon.toFixed(6)}</p>
      <div class="place-item-actions">
        <a class="place-item-link" href="${detailsLink}">Карточка</a>
        <button class="secondary-btn" data-focus="${safeId}" type="button">Показать на карте</button>
      </div>
    `;

    const focusBtn = wrapper.querySelector("button[data-focus]");
    focusBtn.addEventListener("click", () => {
      map.setView([lat, lon], 16, { animate: true });

      for (const layer of placesLayer.getLayers()) {
        const markerLatLng = layer.getLatLng();
        if (Math.abs(markerLatLng.lat - lat) < 1e-7 && Math.abs(markerLatLng.lng - lon) < 1e-7) {
          layer.openPopup();
          break;
        }
      }
    });

    placesList.appendChild(wrapper);
  }
}

async function onSubmit(event) {
  event.preventDefault();

  setStatus("Сохраняем точку...", "");

  const payload = new FormData(form);

  try {
    const response = await fetch("/api/places", {
      method: "POST",
      body: payload,
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Не удалось сохранить точку");
    }

    placesCache.push(data);

    if (
      data.properties &&
      data.properties.categoryId &&
      !categoriesCache.some((item) => item.id === data.properties.categoryId)
    ) {
      categoriesCache.push({
        id: data.properties.categoryId,
        name: data.properties.categoryName || "Новая категория",
        color: normalizeColorOrFallback(data.properties.categoryColor, "#c4572e"),
        createdAt: data.properties.createdAt,
      });
      renderCategorySelect();
      renderCategoriesLegend();
    }

    renderMarkers();
    renderList();

    setStatus("Точка успешно добавлена.", "ok");
    setPageStatus("Добавлено новое место", "ok");
    closeDialog();
    resetFormKeepCoordinates();
  } catch (error) {
    setStatus(error.message || "Ошибка при сохранении", "error");
  }
}

function resetFormKeepCoordinates() {
  const lat = latInput.value;
  const lon = lonInput.value;
  const categoryValue = categoriesCache[0]?.id || NEW_CATEGORY_VALUE;

  form.reset();
  latInput.value = lat;
  lonInput.value = lon;
  categoryIdInput.value = categoryValue;
  categoryColorInput.value = "#c4572e";
  onCategorySelectionChange();
}

function setSelectedCoordinates(lat, lon) {
  latInput.value = lat.toFixed(6);
  lonInput.value = lon.toFixed(6);

  if (!selectionMarker) {
    selectionMarker = L.circleMarker([lat, lon], {
      radius: 9,
      color: "#ffffff",
      fillColor: "#16697a",
      fillOpacity: 0.92,
      weight: 3,
      className: "pin-select",
    }).addTo(map);
  } else {
    selectionMarker.setLatLng([lat, lon]);
  }
}

function setStatus(message, type) {
  statusEl.textContent = message;
  statusEl.classList.remove("error", "ok", "empty");

  if (type) {
    statusEl.classList.add(type);
  }
}

function setPageStatus(message, type) {
  pageStatusEl.textContent = message;
  pageStatusEl.classList.remove("error", "ok", "empty");

  if (type) {
    pageStatusEl.classList.add(type);
  }
}

function normalizeColorOrFallback(value, fallback) {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(normalized)) {
    return fallback;
  }

  return normalized;
}

function escapeHtml(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeHtmlAttribute(value) {
  return escapeHtml(value).replaceAll("`", "");
}
