const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");

const express = require("express");
const multer = require("multer");

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "places.geojson");
const CATEGORIES_FILE = path.join(DATA_DIR, "categories.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const UPLOAD_DIR = path.join(__dirname, "uploads");
const MAX_FILE_SIZE = 1 * 1024 * 1024;
const ADD_PLACE_PASSWORD = process.env.ADD_PLACE_PASSWORD || "nizhneudinsk";
const NEW_CATEGORY_VALUE = "__new__";

const NIZHNEUDINSK_BOUNDS = {
  latMin: 54.8551994,
  latMax: 54.968033,
  lonMin: 98.9290848,
  lonMax: 99.1122392,
};

const DEFAULT_CATEGORY = {
  id: "default",
  name: "Достопримечательность",
  color: "#c4572e",
  createdAt: "2026-01-01T00:00:00.000Z",
};

fsSync.mkdirSync(DATA_DIR, { recursive: true });
fsSync.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const extension = path.extname(file.originalname).toLowerCase();
    const uniqueName = `${Date.now()}-${crypto.randomUUID()}${extension}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      const error = new Error("ALLOWED_ONLY_IMAGES");
      error.code = "ALLOWED_ONLY_IMAGES";
      cb(error);
      return;
    }
    cb(null, true);
  },
});

app.use(express.json());
app.use("/uploads", express.static(UPLOAD_DIR));
app.use(express.static(PUBLIC_DIR));

app.get("/api/places", async (_req, res, next) => {
  try {
    const [places, categories] = await Promise.all([readPlacesGeoJson(), readCategories()]);
    const features = places.features.map((feature) => withCategoryDefaults(feature, categories));
    res.json({
      type: "FeatureCollection",
      features,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/categories", async (_req, res, next) => {
  try {
    const categories = await readCategories();
    res.json(categories);
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/login", (req, res) => {
  const password = normalizeText(req.body && req.body.password);
  if (!isPasswordValid(password)) {
    res.status(401).json({ error: "Неверный пароль" });
    return;
  }

  res.json({ ok: true });
});

app.get("/api/places/:id", async (req, res, next) => {
  try {
    const [places, categories] = await Promise.all([readPlacesGeoJson(), readCategories()]);
    const place = places.features.find((item) => item.id === req.params.id);

    if (!place) {
      res.status(404).json({ error: "Точка не найдена" });
      return;
    }

    res.json(withCategoryDefaults(place, categories));
  } catch (error) {
    next(error);
  }
});

app.post("/api/places", upload.single("photoFile"), async (req, res, next) => {
  const uploadedFilePath = req.file ? req.file.path : null;

  try {
    const password = normalizeText(req.body.password);
    if (!isPasswordValid(password)) {
      await removeFileIfExists(uploadedFilePath);
      res.status(401).json({ error: "Неверный пароль для добавления точки" });
      return;
    }

    const name = normalizeText(req.body.name);
    const description = normalizeText(req.body.description);
    const siteUrlRaw = normalizeText(req.body.siteUrl);
    const photoUrlRaw = normalizeText(req.body.photoUrl);
    const lat = Number.parseFloat(req.body.lat);
    const lon = Number.parseFloat(req.body.lon);

    if (!name) {
      await removeFileIfExists(uploadedFilePath);
      res.status(400).json({ error: "Укажите название места" });
      return;
    }

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      await removeFileIfExists(uploadedFilePath);
      res.status(400).json({ error: "Координаты должны быть числами" });
      return;
    }

    if (!isPointInsideNizhneudinsk(lat, lon)) {
      await removeFileIfExists(uploadedFilePath);
      res.status(400).json({
        error: "Точка должна находиться в границах Нижнеудинска",
      });
      return;
    }

    const siteUrl = parseHttpUrl(siteUrlRaw);
    const photoUrl = parseHttpUrl(photoUrlRaw);

    if (siteUrlRaw && !siteUrl) {
      await removeFileIfExists(uploadedFilePath);
      res.status(400).json({ error: "Ссылка на сайт некорректна" });
      return;
    }

    if (photoUrlRaw && !photoUrl) {
      await removeFileIfExists(uploadedFilePath);
      res.status(400).json({ error: "Ссылка на фото некорректна" });
      return;
    }

    const categories = await readCategories();
    const resolvedCategory = resolveCategoryForPlace(req.body, categories);
    if (resolvedCategory.error) {
      await removeFileIfExists(uploadedFilePath);
      res.status(400).json({ error: resolvedCategory.error });
      return;
    }

    if (resolvedCategory.categoriesChanged) {
      await writeCategories(categories);
    }

    const address = await resolveAddress(lat, lon);
    const places = await readPlacesGeoJson();
    const placeId = createId();

    const feature = {
      type: "Feature",
      id: placeId,
      geometry: {
        type: "Point",
        coordinates: [lon, lat],
      },
      properties: {
        name,
        description,
        siteUrl: siteUrl || "",
        address,
        photo: req.file ? `/uploads/${req.file.filename}` : photoUrl || "",
        categoryId: resolvedCategory.category.id,
        categoryName: resolvedCategory.category.name,
        categoryColor: resolvedCategory.category.color,
        createdAt: new Date().toISOString(),
      },
    };

    places.features.push(feature);
    await writePlacesGeoJson(places);

    res.status(201).json(feature);
  } catch (error) {
    await removeFileIfExists(uploadedFilePath);
    next(error);
  }
});

app.get("/place/:id", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "place.html"));
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    res.status(400).json({ error: "Размер фото не должен превышать 1 МБ" });
    return;
  }

  if (error && error.code === "ALLOWED_ONLY_IMAGES") {
    res.status(400).json({ error: "Можно загружать только файлы изображений" });
    return;
  }

  console.error(error);
  res.status(500).json({ error: "Внутренняя ошибка сервера" });
});

bootstrap().catch((error) => {
  console.error("Failed to bootstrap app:", error);
  process.exit(1);
});

async function bootstrap() {
  if (!fsSync.existsSync(DATA_FILE)) {
    await writePlacesGeoJson({
      type: "FeatureCollection",
      features: [],
    });
  }

  if (!fsSync.existsSync(CATEGORIES_FILE)) {
    await writeCategories([DEFAULT_CATEGORY]);
  }

  await readCategories();

  app.listen(PORT, () => {
    console.log(`Nizhneudinsk map is running on http://localhost:${PORT}`);
  });
}

function normalizeText(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function normalizeCategoryName(value) {
  return normalizeText(value).replace(/\s+/g, " ");
}

function createId() {
  return `${Date.now().toString(36)}${crypto.randomBytes(3).toString("hex")}`;
}

function parseHttpUrl(value) {
  if (!value) {
    return "";
  }

  try {
    const parsedUrl = new URL(value);
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return "";
    }
    return parsedUrl.toString();
  } catch {
    return "";
  }
}

function normalizeHexColor(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(normalized)) {
    return "";
  }

  return normalized;
}

function isPasswordValid(password) {
  if (!password) {
    return false;
  }

  const expected = Buffer.from(ADD_PLACE_PASSWORD, "utf8");
  const received = Buffer.from(password, "utf8");

  if (expected.length !== received.length) {
    return false;
  }

  return crypto.timingSafeEqual(expected, received);
}

function isPointInsideNizhneudinsk(lat, lon) {
  return (
    lat >= NIZHNEUDINSK_BOUNDS.latMin &&
    lat <= NIZHNEUDINSK_BOUNDS.latMax &&
    lon >= NIZHNEUDINSK_BOUNDS.lonMin &&
    lon <= NIZHNEUDINSK_BOUNDS.lonMax
  );
}

function resolveCategoryForPlace(body, categories) {
  const selectedCategoryId = normalizeText(body.categoryId);
  const newCategoryName = normalizeCategoryName(body.categoryName);
  const newCategoryColor = normalizeHexColor(body.categoryColor);

  if (selectedCategoryId && selectedCategoryId !== NEW_CATEGORY_VALUE) {
    const existingCategory = categories.find((category) => category.id === selectedCategoryId);
    if (!existingCategory) {
      return { error: "Выбранная категория не найдена" };
    }
    return { category: existingCategory, categoriesChanged: false };
  }

  if (selectedCategoryId === NEW_CATEGORY_VALUE || newCategoryName || newCategoryColor) {
    if (!newCategoryName) {
      return { error: "Укажите название новой категории" };
    }

    if (!newCategoryColor) {
      return { error: "Цвет категории должен быть в формате #RRGGBB" };
    }

    const foundByName = categories.find(
      (category) => category.name.toLowerCase() === newCategoryName.toLowerCase()
    );
    if (foundByName) {
      return { category: foundByName, categoriesChanged: false };
    }

    const newCategory = {
      id: createId(),
      name: newCategoryName,
      color: newCategoryColor,
      createdAt: new Date().toISOString(),
    };

    categories.push(newCategory);
    return { category: newCategory, categoriesChanged: true };
  }

  return { category: categories[0] || { ...DEFAULT_CATEGORY }, categoriesChanged: false };
}

function withCategoryDefaults(feature, categories) {
  const fallbackCategory = categories[0] || DEFAULT_CATEGORY;
  const sourceProperties =
    feature.properties && typeof feature.properties === "object" ? feature.properties : {};
  const requestedCategoryId = normalizeText(sourceProperties.categoryId);
  const requestedCategoryName = normalizeCategoryName(sourceProperties.categoryName);

  const categoryFromId = categories.find((category) => category.id === requestedCategoryId) || null;
  const categoryFromName =
    categoryFromId || !requestedCategoryName
      ? null
      : categories.find(
          (category) => category.name.toLowerCase() === requestedCategoryName.toLowerCase()
        ) || null;

  const resolvedCategory = categoryFromId || categoryFromName || fallbackCategory;
  const categoryColor = normalizeHexColor(sourceProperties.categoryColor) || resolvedCategory.color;

  return {
    ...feature,
    properties: {
      ...sourceProperties,
      categoryId: resolvedCategory.id,
      categoryName: requestedCategoryName || resolvedCategory.name,
      categoryColor,
    },
  };
}

async function readPlacesGeoJson() {
  const rawFile = await fs.readFile(DATA_FILE, "utf8");
  const parsed = JSON.parse(rawFile);

  if (parsed.type !== "FeatureCollection" || !Array.isArray(parsed.features)) {
    throw new Error("Invalid GeoJSON structure");
  }

  return parsed;
}

async function writePlacesGeoJson(data) {
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
}

async function readCategories() {
  const rawFile = await fs.readFile(CATEGORIES_FILE, "utf8");
  const parsed = JSON.parse(rawFile);

  if (!parsed || !Array.isArray(parsed.categories)) {
    throw new Error("Invalid categories structure");
  }

  const categories = [];
  const seenIds = new Set();

  for (const item of parsed.categories) {
    if (!isValidCategory(item)) {
      continue;
    }

    if (seenIds.has(item.id)) {
      continue;
    }

    categories.push({
      id: item.id,
      name: normalizeCategoryName(item.name),
      color: normalizeHexColor(item.color),
      createdAt:
        typeof item.createdAt === "string" && item.createdAt
          ? item.createdAt
          : new Date().toISOString(),
    });

    seenIds.add(item.id);
  }

  const ensured = ensureDefaultCategory(categories);
  if (ensured.changed) {
    await writeCategories(ensured.categories);
  }

  return ensured.categories;
}

async function writeCategories(categories) {
  await fs.writeFile(
    CATEGORIES_FILE,
    JSON.stringify(
      {
        categories,
      },
      null,
      2
    ),
    "utf8"
  );
}

function isValidCategory(item) {
  if (!item || typeof item !== "object") {
    return false;
  }

  if (!normalizeText(item.id)) {
    return false;
  }

  if (!normalizeCategoryName(item.name)) {
    return false;
  }

  if (!normalizeHexColor(item.color)) {
    return false;
  }

  return true;
}

function ensureDefaultCategory(categories) {
  const hasDefault = categories.some((category) => category.id === DEFAULT_CATEGORY.id);
  if (hasDefault) {
    return { categories, changed: false };
  }

  return {
    categories: [{ ...DEFAULT_CATEGORY }, ...categories],
    changed: true,
  };
}

async function resolveAddress(lat, lon) {
  try {
    const apiUrl = new URL("https://nominatim.openstreetmap.org/reverse");
    apiUrl.searchParams.set("format", "jsonv2");
    apiUrl.searchParams.set("lat", String(lat));
    apiUrl.searchParams.set("lon", String(lon));
    apiUrl.searchParams.set("accept-language", "ru");
    apiUrl.searchParams.set("zoom", "18");

    const response = await fetch(apiUrl, {
      headers: {
        "User-Agent": "NizhneudinskMap/1.0 (local server)",
      },
    });

    if (!response.ok) {
      throw new Error(`Reverse geocoding failed with status ${response.status}`);
    }

    const payload = await response.json();
    if (payload && typeof payload.display_name === "string") {
      return payload.display_name;
    }
  } catch (error) {
    console.warn("Unable to resolve address using Nominatim:", error.message);
  }

  return `Нижнеудинск, координаты ${lat.toFixed(6)}, ${lon.toFixed(6)}`;
}

async function removeFileIfExists(filePath) {
  if (!filePath) {
    return;
  }

  try {
    await fs.unlink(filePath);
  } catch {
    // no-op
  }
}
