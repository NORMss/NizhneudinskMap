const loadingState = document.getElementById("loadingState");
const errorState = document.getElementById("errorState");
const placeContent = document.getElementById("placeContent");

const placeName = document.getElementById("placeName");
const placeAddress = document.getElementById("placeAddress");
const placeDescription = document.getElementById("placeDescription");
const placeCoordinates = document.getElementById("placeCoordinates");
const placeCategory = document.getElementById("placeCategory");
const placeSite = document.getElementById("placeSite");
const placeDate = document.getElementById("placeDate");
const imageHost = document.getElementById("imageHost");

init().catch((error) => {
  showError(error.message || "Ошибка загрузки карточки");
});

async function init() {
  const placeId = extractPlaceIdFromPathname(window.location.pathname);
  if (!placeId) {
    throw new Error("Некорректный адрес карточки");
  }

  const response = await fetch(`/api/places/${encodeURIComponent(placeId)}`);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Место не найдено");
  }

  renderPlace(data);
}

function renderPlace(feature) {
  const { properties, geometry } = feature;
  const [lon, lat] = geometry.coordinates;

  placeName.textContent = properties.name;
  placeAddress.textContent = properties.address || "Адрес уточняется";
  placeDescription.textContent = properties.description || "Описание пока не добавлено.";
  placeCoordinates.textContent = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;

  const categoryName = properties.categoryName || "Без категории";
  const categoryColor = normalizeColorOrFallback(properties.categoryColor, "#c4572e");
  placeCategory.innerHTML = `
    <span class="place-category">
      <span class="place-category-dot" style="background:${escapeHtmlAttribute(categoryColor)}"></span>
      ${escapeHtml(categoryName)}
    </span>
  `;

  if (properties.siteUrl) {
    const link = document.createElement("a");
    link.href = properties.siteUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = properties.siteUrl;
    placeSite.replaceChildren(link);
  } else {
    placeSite.textContent = "Не указан";
  }

  const createdAt = new Date(properties.createdAt);
  placeDate.textContent = Number.isNaN(createdAt.getTime())
    ? "Неизвестно"
    : createdAt.toLocaleString("ru-RU");

  if (properties.photo) {
    const img = document.createElement("img");
    img.className = "place-card-image";
    img.alt = properties.name;
    img.loading = "lazy";
    img.src = properties.photo;
    imageHost.replaceChildren(img);
  } else {
    const placeholder = document.createElement("div");
    placeholder.className = "placeholder";
    placeholder.textContent = "Фото не добавлено";
    imageHost.replaceChildren(placeholder);
  }

  loadingState.hidden = true;
  placeContent.hidden = false;
}

function extractPlaceIdFromPathname(pathname) {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length < 2) {
    return "";
  }

  return decodeURIComponent(parts[1]);
}

function showError(message) {
  loadingState.hidden = true;
  errorState.hidden = false;
  errorState.textContent = message;
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
