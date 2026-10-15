/**
 * ValutaFlow — Modern Currency Converter Logic
 * Features:
 * - Real-time ExchangeRate-API integration with rate caching
 * - Interactive currency swapping with animation
 * - Quick amount presets & popular currency pairs
 * - Copy to clipboard with toast notification
 * - Dark & Light mode toggle with persistent state
 * - Keyboard shortcuts (Enter to convert, 'S' to swap)
 * - Error handling with retry functionality
 */

// API Configuration
const API_KEY = "f44e422cd144ec38624c1fe7";
const BASE_URL = `https://v6.exchangerate-api.com/v6/${API_KEY}/latest`;

// In-Memory Rate Cache to reduce API requests & improve responsiveness
const ratesCache = {};

// Currency Symbol Map for Amount Input
const currencySymbols = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  INR: "₹",
  JPY: "¥",
  CAD: "C$",
  AUD: "A$",
  CHF: "CHF",
  CNY: "¥",
  AED: "AED",
  SGD: "S$",
  NZD: "NZ$",
  BRL: "R$",
  ZAR: "R",
  MXN: "Mex$",
  RUB: "₽",
  KRW: "₩",
  TRY: "₺",
  SEK: "kr",
  NOK: "kr",
  DKK: "kr",
};

// DOM Elements
const form = document.getElementById("converterForm");
const amountInput = document.getElementById("amountInput");
const clearAmountBtn = document.getElementById("clearAmount");
const fromSelect = document.getElementById("fromSelect");
const toSelect = document.getElementById("toSelect");
const swapBtn = document.getElementById("swapBtn");
const submitBtn = document.getElementById("submitBtn");
const currencySymbol = document.getElementById("currencySymbol");

const fromFullName = document.getElementById("fromFullName");
const toFullName = document.getElementById("toFullName");

const resultCard = document.getElementById("resultCard");
const sourceAmountText = document.getElementById("sourceAmountText");
const convertedAmount = document.getElementById("convertedAmount");
const targetCurrencyCode = document.getElementById("targetCurrencyCode");
const rateMsg = document.getElementById("rateMsg");
const inverseRateMsg = document.getElementById("inverseRateMsg");
const lastUpdated = document.getElementById("lastUpdated");
const copyBtn = document.getElementById("copyBtn");

const errorBanner = document.getElementById("errorBanner");
const errorMessage = document.getElementById("errorMessage");
const retryBtn = document.getElementById("retryBtn");

const themeToggle = document.getElementById("themeToggle");
const toast = document.getElementById("toast");
const amountPills = document.querySelectorAll(".amount-pill");
const pairChips = document.querySelectorAll(".pair-chip");

// -----------------------------------------------------------------------------
// 1. Theme Management (Dark / Light Mode)
// -----------------------------------------------------------------------------
const initTheme = () => {
  const savedTheme = localStorage.getItem("valutaflow_theme") || "dark";
  document.documentElement.setAttribute("data-theme", savedTheme);
};

const toggleTheme = () => {
  const currentTheme = document.documentElement.getAttribute("data-theme") || "dark";
  const newTheme = currentTheme === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", newTheme);
  localStorage.setItem("valutaflow_theme", newTheme);
  showToast(`Switched to ${newTheme === "dark" ? "Dark" : "Light"} Mode`);
};

themeToggle.addEventListener("click", toggleTheme);

// -----------------------------------------------------------------------------
// 2. Populate Dropdowns & Flags
// -----------------------------------------------------------------------------
const populateDropdowns = () => {
  if (typeof countryList === "undefined") {
    console.error("countryList is not defined! Check codes.js");
    return;
  }

  const dropdowns = [fromSelect, toSelect];

  for (const select of dropdowns) {
    select.innerHTML = "";

    for (const currCode of Object.keys(countryList)) {
      const option = document.createElement("option");
      option.value = currCode;

      const name = (typeof currencyNames !== "undefined" && currencyNames[currCode])
        ? currencyNames[currCode]
        : "";

      option.innerText = name ? `${currCode} — ${name}` : currCode;

      if (select.name === "from" && currCode === "USD") {
        option.selected = true;
      } else if (select.name === "to" && currCode === "INR") {
        option.selected = true;
      }

      select.appendChild(option);
    }

    select.addEventListener("change", (e) => {
      handleCurrencyChange(e.target);
    });
  }

  updateFlagAndLabels(fromSelect);
  updateFlagAndLabels(toSelect);
};

const updateFlagAndLabels = (selectElement) => {
  const currCode = selectElement.value;
  const countryCode = countryList[currCode] || "UN";
  const flagImg = selectElement.closest(".select-container").querySelector(".flag-img");

  if (flagImg) {
    flagImg.src = `https://flagsapi.com/${countryCode}/flat/64.png`;
    flagImg.alt = `${currCode} flag`;
    flagImg.onerror = () => {
      flagImg.src = `https://flagsapi.com/US/flat/64.png`;
    };
  }

  const fullName = (typeof currencyNames !== "undefined" && currencyNames[currCode])
    ? currencyNames[currCode]
    : currCode;

  if (selectElement.name === "from") {
    fromFullName.innerText = fullName;
    currencySymbol.innerText = currencySymbols[currCode] || "$";
  } else {
    toFullName.innerText = fullName;
  }
};

const handleCurrencyChange = (selectElement) => {
  updateFlagAndLabels(selectElement);
  updateActivePairChip();
  updateExchangeRate();
};

// -----------------------------------------------------------------------------
// 3. Formatters
// -----------------------------------------------------------------------------
const formatNumber = (num, maxDecimals = 2) => {
  if (isNaN(num)) return "0.00";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: maxDecimals,
  }).format(num);
};

const formatRate = (rate) => {
  if (isNaN(rate)) return "0.00";
  if (rate >= 100) return formatNumber(rate, 2);
  if (rate >= 1) return formatNumber(rate, 4);
  return formatNumber(rate, 6);
};

// -----------------------------------------------------------------------------
// 4. Exchange Rate Fetch & Calculation
// -----------------------------------------------------------------------------
const updateExchangeRate = async () => {
  let amtVal = parseFloat(amountInput.value);

  if (isNaN(amtVal) || amtVal <= 0) {
    amtVal = 1;
    amountInput.value = "1";
  }

  const fromCurr = fromSelect.value;
  const toCurr = toSelect.value;

  // Visual loading state
  submitBtn.classList.add("loading");
  submitBtn.disabled = true;
  swapBtn.disabled = true;

  try {
    let conversionRates;

    // Check rate cache first (valid for current session)
    if (ratesCache[fromCurr]) {
      conversionRates = ratesCache[fromCurr];
    } else {
      const response = await fetch(`${BASE_URL}/${fromCurr}`);
      if (!response.ok) {
        throw new Error(`Server returned HTTP ${response.status}`);
      }

      const data = await response.json();
      if (data.result !== "success" || !data.conversion_rates) {
        throw new Error(data["error-type"] || "Failed to retrieve conversion rates");
      }

      conversionRates = data.conversion_rates;
      ratesCache[fromCurr] = conversionRates;
    }

    const rate = conversionRates[toCurr];
    if (typeof rate !== "number") {
      throw new Error(`Rate unavailable for ${toCurr}`);
    }

    const finalAmount = amtVal * rate;
    const inverseRate = 1 / rate;

    // Update UI Elements
    sourceAmountText.innerText = `${formatNumber(amtVal)} ${fromCurr} =`;
    convertedAmount.innerText = formatNumber(finalAmount, rate < 0.01 ? 4 : 2);
    targetCurrencyCode.innerText = toCurr;

    rateMsg.innerText = `1 ${fromCurr} = ${formatRate(rate)} ${toCurr}`;
    inverseRateMsg.innerText = `1 ${toCurr} = ${formatRate(inverseRate)} ${fromCurr}`;

    const now = new Date();
    lastUpdated.innerText = `Updated: ${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;

    // Hide any previous errors
    errorBanner.style.display = "none";
    resultCard.style.display = "flex";

  } catch (err) {
    console.error("Exchange rate fetch error:", err);
    errorMessage.innerText = err.message || "Network error. Please check your internet connection.";
    errorBanner.style.display = "flex";
  } finally {
    submitBtn.classList.remove("loading");
    submitBtn.disabled = false;
    swapBtn.disabled = false;
  }
};

// -----------------------------------------------------------------------------
// 5. Swap Currencies Feature
// -----------------------------------------------------------------------------
const swapCurrencies = () => {
  swapBtn.classList.add("rotating");

  const tempVal = fromSelect.value;
  fromSelect.value = toSelect.value;
  toSelect.value = tempVal;

  updateFlagAndLabels(fromSelect);
  updateFlagAndLabels(toSelect);
  updateActivePairChip();

  setTimeout(() => {
    swapBtn.classList.remove("rotating");
  }, 400);

  updateExchangeRate();
};

swapBtn.addEventListener("click", swapCurrencies);

// -----------------------------------------------------------------------------
// 6. Quick Amount Pills
// -----------------------------------------------------------------------------
amountPills.forEach((pill) => {
  pill.addEventListener("click", () => {
    amountPills.forEach((p) => p.classList.remove("active"));
    pill.classList.add("active");

    amountInput.value = pill.getAttribute("data-amount");
    updateExchangeRate();
  });
});

amountInput.addEventListener("input", () => {
  const currentVal = amountInput.value.trim();
  amountPills.forEach((pill) => {
    if (pill.getAttribute("data-amount") === currentVal) {
      pill.classList.add("active");
    } else {
      pill.classList.remove("active");
    }
  });
});

// Clear input button
clearAmountBtn.addEventListener("click", () => {
  amountInput.value = "";
  amountInput.focus();
  amountPills.forEach((p) => p.classList.remove("active"));
});

// -----------------------------------------------------------------------------
// 7. Popular Currency Pair Chips
// -----------------------------------------------------------------------------
const updateActivePairChip = () => {
  const currentPair = `${fromSelect.value}/${toSelect.value}`;
  pairChips.forEach((chip) => {
    const chipPair = `${chip.getAttribute("data-from")}/${chip.getAttribute("data-to")}`;
    if (chipPair === currentPair) {
      chip.classList.add("active-pair");
    } else {
      chip.classList.remove("active-pair");
    }
  });
};

pairChips.forEach((chip) => {
  chip.addEventListener("click", () => {
    const from = chip.getAttribute("data-from");
    const to = chip.getAttribute("data-to");

    fromSelect.value = from;
    toSelect.value = to;

    updateFlagAndLabels(fromSelect);
    updateFlagAndLabels(toSelect);
    updateActivePairChip();
    updateExchangeRate();
  });
});

// -----------------------------------------------------------------------------
// 8. Copy to Clipboard
// -----------------------------------------------------------------------------
copyBtn.addEventListener("click", async () => {
  const textToCopy = `${sourceAmountText.innerText} ${convertedAmount.innerText} ${targetCurrencyCode.innerText} (${rateMsg.innerText})`;

  try {
    await navigator.clipboard.writeText(textToCopy);
    copyBtn.classList.add("copied");
    const copyText = copyBtn.querySelector(".copy-text");
    copyText.innerText = "Copied!";
    showToast("Conversion copied to clipboard!");

    setTimeout(() => {
      copyBtn.classList.remove("copied");
      copyText.innerText = "Copy";
    }, 2000);
  } catch (e) {
    showToast("Failed to copy to clipboard");
  }
});

// Toast notification helper
let toastTimeout;
const showToast = (message) => {
  if (!toast) return;
  toast.innerText = message;
  toast.classList.add("show");

  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.remove("show");
  }, 2600);
};

// -----------------------------------------------------------------------------
// 9. Form Submission & Keyboard Shortcuts
// -----------------------------------------------------------------------------
form.addEventListener("submit", (e) => {
  e.preventDefault();
  updateExchangeRate();
});

// Retry button on error
retryBtn.addEventListener("click", () => {
  updateExchangeRate();
});

// Keyboard shortcuts: 'S' to swap currencies (when not in input)
document.addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() === "s" && document.activeElement !== amountInput) {
    e.preventDefault();
    swapCurrencies();
  }
});

// -----------------------------------------------------------------------------
// 10. Initialization on Load
// -----------------------------------------------------------------------------
window.addEventListener("DOMContentLoaded", () => {
  initTheme();
  populateDropdowns();
  updateExchangeRate();
});