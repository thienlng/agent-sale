(() => {
  const section = document.getElementById("platform");
  if (!section) return;
  const tabList = section.querySelector(".tour-tabs");
  const tabs = Array.from(tabList.querySelectorAll("a"));
  const panels = tabs.map(tab => document.getElementById(tab.hash.slice(1)));

  function selectTab(index) {
    tabs.forEach((tab, position) => {
      const selected = position === index;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      panels[position].hidden = !selected;
    });
  }

  function selectManually(index) {
    selectTab(index);
    if (tabs.some(tab => tab.hash === window.location.hash)) {
      history.replaceState(history.state, "", tabs[index].hash);
    }
  }

  tabList.setAttribute("role", "tablist");
  tabs.forEach((tab, index) => {
    const panel = panels[index];
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", panel.id);
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", tab.id);
    panel.tabIndex = 0;

    tab.addEventListener("click", event => {
      event.preventDefault();
      selectManually(index);
    });

    tab.addEventListener("keydown", event => {
      const destinations = {
        ArrowLeft: (index + tabs.length - 1) % tabs.length,
        ArrowRight: (index + 1) % tabs.length,
        Home: 0,
        End: tabs.length - 1
      };
      if (event.key === " ") {
        event.preventDefault();
        selectManually(index);
      } else if (Object.hasOwn(destinations, event.key)) {
        event.preventDefault();
        const next = destinations[event.key];
        selectManually(next);
        tabs[next].focus();
      }
    });
  });

  function showLinkedPanel() {
    const index = tabs.findIndex(tab => tab.hash === window.location.hash);
    if (index < 0) return;
    selectTab(index);
    panels[index].scrollIntoView({ block: "start" });
  }

  selectTab(0);
  showLinkedPanel();
  window.addEventListener("hashchange", showLinkedPanel);
})();

(() => {
  const section = document.getElementById("platform");
  if (!section || typeof HTMLDialogElement === "undefined") return;

  const viewer = document.createElement("dialog");
  if (typeof viewer.showModal !== "function") return;
  viewer.className = "tour-viewer";
  viewer.setAttribute("aria-labelledby", "tour-viewer-title");
  viewer.setAttribute("aria-describedby", "tour-viewer-caption");
  viewer.innerHTML = `
    <div class="tour-viewer-bar">
      <h3 id="tour-viewer-title"></h3>
      <button class="tour-viewer-close" type="button" aria-label="Đóng ảnh" autofocus>×</button>
    </div>
    <div class="tour-viewer-stage" tabindex="0" role="region" aria-label="Ảnh màn hình sản phẩm">
      <img draggable="false" alt="">
    </div>
    <div class="tour-viewer-footer">
      <p id="tour-viewer-caption"></p>
      <button class="tour-viewer-zoom" type="button" aria-pressed="false">Phóng to</button>
    </div>`;
  section.append(viewer);

  const stage = viewer.querySelector(".tour-viewer-stage");
  const image = stage.querySelector("img");
  const title = viewer.querySelector("h3");
  const caption = viewer.querySelector("#tour-viewer-caption");
  const zoom = viewer.querySelector(".tour-viewer-zoom");
  let opener;

  function setZoom(enlarged) {
    stage.classList.toggle("tour-enlarged", enlarged);
    zoom.setAttribute("aria-pressed", String(enlarged));
    zoom.textContent = enlarged ? "Thu nhỏ" : "Phóng to";
    stage.scrollTo(0, 0);
  }

  section.querySelectorAll(".tour-expand").forEach(link => {
    const panel = link.closest(".tour-panel");
    const tab = document.getElementById(panel.getAttribute("aria-labelledby"));
    const screen = panel.querySelector(".tour-frame img");
    link.firstChild.textContent = "Xem toàn màn hình ";
    link.setAttribute("aria-label", "Xem toàn màn hình: " + tab.textContent);
    link.setAttribute("aria-haspopup", "dialog");

    link.addEventListener("click", event => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      opener = link;
      image.src = link.href;
      image.alt = screen.alt;
      title.textContent = tab.textContent;
      caption.textContent = panel.querySelector(".tour-caption p").textContent;
      setZoom(false);
      viewer.showModal();
    });
  });

  zoom.addEventListener("click", () => setZoom(!stage.classList.contains("tour-enlarged")));
  viewer.querySelector(".tour-viewer-close").addEventListener("click", () => viewer.close());
  viewer.addEventListener("close", () => opener?.focus({ preventScroll: true }));
})();
