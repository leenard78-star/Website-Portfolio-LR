const yearElement = document.getElementById("year");

if (yearElement) {
    yearElement.textContent = new Date().getFullYear();
}

const navToggle = document.querySelector(".nav-toggle");
const navPanel = document.querySelector(".nav-panel");

if (navToggle && navPanel) {
    const closeMenu = () => {
        navPanel.classList.remove("is-open");
        navToggle.setAttribute("aria-expanded", "false");
        navToggle.setAttribute("aria-label", "Open navigation menu");
    };

    navToggle.addEventListener("click", (event) => {
        event.stopPropagation();
        const isOpen = navPanel.classList.toggle("is-open");
        navToggle.setAttribute("aria-expanded", String(isOpen));
        navToggle.setAttribute("aria-label", isOpen ? "Close navigation menu" : "Open navigation menu");
    });

    navPanel.querySelectorAll("a").forEach((link) => {
        link.addEventListener("click", closeMenu);
    });

    document.addEventListener("click", (event) => {
        if (!navPanel.contains(event.target) && !navToggle.contains(event.target)) {
            closeMenu();
        }
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            closeMenu();
        }
    });

    window.addEventListener("resize", () => {
        if (window.innerWidth > 900) {
            closeMenu();
        }
    });
}

const revealElements = document.querySelectorAll(".reveal");
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

if (prefersReducedMotion || !("IntersectionObserver" in window)) {
    revealElements.forEach((element) => element.classList.add("is-visible"));
} else {
    const revealObserver = new IntersectionObserver(
        (entries, observer) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    entry.target.classList.add("is-visible");
                    observer.unobserve(entry.target);
                }
            });
        },
        { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }
    );

    revealElements.forEach((element) => revealObserver.observe(element));
}

if ("IntersectionObserver" in window) {
    const sections = document.querySelectorAll("main section[id]");
    const navLinks = document.querySelectorAll(".nav-link");

    const activeSectionObserver = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) {
                    return;
                }

                navLinks.forEach((link) => {
                    const isActive = link.getAttribute("href") === `#${entry.target.id}`;
                    link.classList.toggle("is-active", isActive);

                    if (isActive) {
                        link.setAttribute("aria-current", "page");
                    } else {
                        link.removeAttribute("aria-current");
                    }
                });
            });
        },
        { rootMargin: "-42% 0px -52% 0px", threshold: 0 }
    );

    sections.forEach((section) => activeSectionObserver.observe(section));
}

const siteHeader = document.querySelector(".site-header");
const heroSection = document.getElementById("home");
const heroPortrait = document.querySelector(".hero-portrait");

if (siteHeader || heroPortrait) {
    let scrollQueued = false;

    const updateScrollEffects = () => {
        if (siteHeader) {
            siteHeader.classList.toggle("is-scrolled", window.scrollY > 24);
        }

        if (heroPortrait && heroSection && !prefersReducedMotion) {
            const heroRect = heroSection.getBoundingClientRect();
            const fadeDistance = Math.max(1, heroRect.height * 0.72);
            const progress = Math.min(1, Math.max(0, -heroRect.top / fadeDistance));
            heroPortrait.style.opacity = String(1 - progress);
        }

        scrollQueued = false;
    };

    window.addEventListener(
        "scroll",
        () => {
            if (!scrollQueued) {
                scrollQueued = true;
                requestAnimationFrame(updateScrollEffects);
            }
        },
        { passive: true }
    );

    updateScrollEffects();
}
