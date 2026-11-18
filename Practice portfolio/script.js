(function () {
  "use strict";

  var STORAGE_KEY = "community-connect-reports";
  var HOUR = 3600 * 1000;
  var DAY = 24 * HOUR;

  var form = document.getElementById("report-form");
  var message = document.getElementById("form-message");
  var list = document.getElementById("report-list");
  var emptyState = document.getElementById("empty-state");
  var clearButton = document.getElementById("clear-reports");
  var filterButtons = document.querySelectorAll(".filter");

  var activeFilter = "All";

  /* ---------- Sample reports (shown until the first real one is saved) ---------- */
  function sampleReports() {
    var now = Date.now();
    return [
      {
        id: "S-1",
        category: "Broken streetlight",
        location: "Rizal Street",
        details: "The light near the corner store has been off for a week. The street is very dark at night.",
        urgency: "Medium",
        status: "In progress",
        created: now - 2 * DAY
      },
      {
        id: "S-2",
        category: "Garbage or illegal dumping",
        location: "Beside the market",
        details: "Uncollected garbage is blocking part of the sidewalk and attracting flies.",
        urgency: "Medium",
        status: "Received",
        created: now - 1 * DAY
      },
      {
        id: "S-3",
        category: "Flooding or drainage",
        location: "Near the school",
        details: "Water collects on the road after every rain. Cleared by the barangay crew.",
        urgency: "Low",
        status: "Resolved",
        created: now - 5 * DAY
      }
    ];
  }

  /* ---------- Storage ---------- */
  function loadReports() {
    try {
      var saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch (e) { /* storage unavailable or corrupted: fall back to samples */ }
    return sampleReports();
  }

  function saveReports(reports) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(reports));
      return true;
    } catch (e) {
      return false;
    }
  }

  var reports = loadReports();

  /* ---------- Helpers ---------- */
  function timeAgo(timestamp) {
    var diff = Date.now() - timestamp;
    if (diff < HOUR) return "Just now";
    if (diff < DAY) {
      var h = Math.floor(diff / HOUR);
      return h + (h === 1 ? " hour ago" : " hours ago");
    }
    var d = Math.floor(diff / DAY);
    if (d === 1) return "Yesterday";
    return d + " days ago";
  }

  function statusClass(status) {
    if (status === "Resolved") return "status-done";
    if (status === "In progress") return "status-progress";
    return "status-new";
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text; // textContent keeps user input safe
    return node;
  }

  /* ---------- Rendering ---------- */
  function render() {
    list.innerHTML = "";

    var visible = reports
      .filter(function (r) { return activeFilter === "All" || r.status === activeFilter; })
      .sort(function (a, b) { return b.created - a.created; });

    visible.forEach(function (r) {
      var item = el("li");

      var main = el("div", "report-main");
      main.appendChild(el("h3", "", r.category + " – " + r.location));
      main.appendChild(el("p", "", r.details));
      if (r.photo) {
        var img = el("img", "report-photo");
        img.src = r.photo;
        img.alt = "Photo attached to the report";
        main.appendChild(img);
      }

      var meta = el("div", "report-meta");
      meta.appendChild(el("span", "status " + statusClass(r.status), r.status));
      if (r.urgency === "High") meta.appendChild(el("span", "status status-urgent", "Dangerous"));
      meta.appendChild(el("span", "when", timeAgo(r.created)));

      item.appendChild(main);
      item.appendChild(meta);
      list.appendChild(item);
    });

    emptyState.hidden = visible.length > 0;
  }

  /* ---------- Filters ---------- */
  filterButtons.forEach(function (button) {
    button.addEventListener("click", function () {
      activeFilter = button.getAttribute("data-filter");
      filterButtons.forEach(function (b) {
        var on = b === button;
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-pressed", String(on));
      });
      render();
    });
  });

  /* ---------- Photo: shrink before saving so storage doesn't fill up ---------- */
  function readPhoto(file) {
    return new Promise(function (resolve) {
      if (!file || !file.type.startsWith("image/")) return resolve("");
      var reader = new FileReader();
      reader.onerror = function () { resolve(""); };
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () { resolve(""); };
        img.onload = function () {
          var max = 480;
          var scale = Math.min(1, max / Math.max(img.width, img.height));
          var canvas = document.createElement("canvas");
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/jpeg", 0.7));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  /* ---------- Form ---------- */
  function showMessage(text, isError) {
    message.textContent = text;
    message.className = "form-message " + (isError ? "is-error" : "is-success");
  }

  function clearErrors() {
    form.querySelectorAll("[aria-invalid]").forEach(function (f) { f.removeAttribute("aria-invalid"); });
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    clearErrors();

    var data = {
      category: form.category.value.trim(),
      location: form.location.value.trim(),
      details: form.details.value.trim()
    };

    // Required fields: category, location, details (whitespace-only counts as empty)
    var labels = { category: "category", location: "location", details: "description" };
    var missing = Object.keys(data).filter(function (key) { return !data[key]; });

    if (missing.length) {
      missing.forEach(function (key) { form[key].setAttribute("aria-invalid", "true"); });
      form[missing[0]].focus();
      showMessage("Please fill in the " + missing.map(function (k) { return labels[k]; }).join(", ") + ".", true);
      return;
    }

    var submitButton = form.querySelector("button[type='submit']");
    submitButton.disabled = true;
    submitButton.textContent = "Sending…";

    readPhoto(form.photo.files[0]).then(function (photo) {
      var urgency = form.urgency.value;
      var report = {
        id: "R-" + Date.now().toString(36).toUpperCase(),
        category: data.category,
        location: data.location,
        details: data.details,
        urgency: urgency,
        status: "Received",
        created: Date.now(),
        photo: photo
      };

      reports.push(report);
      var saved = saveReports(reports);

      activeFilter = "All";
      filterButtons.forEach(function (b) {
        var on = b.getAttribute("data-filter") === "All";
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-pressed", String(on));
      });
      render();

      form.reset();
      submitButton.disabled = false;
      submitButton.textContent = "Send report";

      showMessage(
        saved
          ? "Report sent. Your reference number is " + report.id + "."
          : "Report added, but it could not be saved on this device and will disappear when you close the page.",
        !saved
      );

      document.getElementById("recent").scrollIntoView({ behavior: "smooth" });
    });
  });

  /* ---------- Clear ---------- */
  clearButton.addEventListener("click", function () {
    if (!window.confirm("Remove all reports saved on this device?")) return;
    reports = [];
    saveReports(reports);
    render();
  });

  render();
})();