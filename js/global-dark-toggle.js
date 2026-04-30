// global-dark-toggle.js

// 1. Pages where the global floating toggle should NOT appear
// (Because they already have their own dark mode toggle in the side drawer)
const EXCLUDED_PAGES = [
    '/parent-home.html',
    '/bookings.html',
    '/reports.html',
    '/profile.html',
    '/notifications.html'
];

(function initGlobalDarkMode() {
    // Check if the current page is in the excluded list using endsWith
    const currentPath = window.location.pathname.toLowerCase();
    const isExcluded = EXCLUDED_PAGES.some(page => currentPath.endsWith(page));

    // If excluded, do absolutely nothing (exit completely)
    if (isExcluded) return;

    // --- 2. Synchronous Dark Mode check to prevent FOUC ---
    // If the user previously selected dark mode, apply it to the HTML tag immediately.
    const isDark = localStorage.getItem("gleam_dark") === "1";
    if (isDark) {
        document.documentElement.classList.add("dark-mode");
    }

    // --- 3. Inject the CSS for the floating toggle button and global dark mode overrides ---
    const style = document.createElement("style");
    style.textContent = `
        /* Global Dark Mode Overrides for Landing/Auth Pages */
        html.dark-mode {
            /* Override landing.css variables */
            --green-ghost:   #0f1c16;
            --green-pale:    #183626;
            --white:         #1a2520;
            --off-white:     #111c17;
            --text-dark:     #ffffff;
            --text-mid:      #e4e4e4;
            --text-muted:    #a0b2ab;
            --border:        #2a3a2f;
            --shadow-sm:     0 2px 8px rgba(0,0,0,0.3);
            --shadow-md:     0 6px 24px rgba(0,0,0,0.4);
            --shadow-lg:     0 16px 48px rgba(0,0,0,0.5);
            background-color: var(--off-white);
            color: var(--text-dark);
        }

        html.dark-mode .navbar {
            background: rgba(26, 37, 32, 0.95);
        }

        html.dark-mode .hero-badge {
            background: var(--green-dark);
            color: #ffffff; /* Explicitly white so it doesn't turn dark */
        }

        html.dark-mode .btn-cta-white {
            background: #ffffff;
            color: var(--green-dark);
        }

        /* Fix Footer: Since footer uses rgba(255,255,255), we must make the footer background very dark, 
           ignoring the --text-dark variable which became white */
        html.dark-mode footer {
            background: #0a130f;
            color: #ffffff;
        }
        html.dark-mode .footer-col h5 {
            color: #ffffff;
        }

        /* Fix Provider Team Reports Contrast */
        html.dark-mode .rc-section-title {
            color: var(--green-light);
        }
        html.dark-mode .rc-file {
            color: var(--green-light);
            border-color: var(--green-dark);
        }

        /* Floating Dark Mode Toggle Button (Upper Right) */
        #global-dark-toggle {
            position: fixed;
            top: 90px;
            right: 20px;
            width: 48px;
            height: 48px;
            border-radius: 50%;
            background-color: #0D524F;
            color: #ffffff;
            border: 2px solid rgba(255, 255, 255, 0.2);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            cursor: pointer;
            z-index: 9999;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.3s ease;
        }

        #global-dark-toggle:hover {
            transform: translateY(-3px) scale(1.05);
            box-shadow: 0 6px 16px rgba(0, 0, 0, 0.2);
            background-color: #16807A;
        }

        #global-dark-toggle .material-symbols-outlined {
            font-size: 24px;
            transition: transform 0.3s ease;
        }

        /* When dark mode is active, adjust button appearance */
        html.dark-mode #global-dark-toggle {
            background-color: #39CB69;
            color: #111c17;
            border-color: rgba(17, 28, 23, 0.2);
        }
    `;
    document.head.appendChild(style);

    // --- 3.5 Inject Material Symbols Font if missing ---
    if (!document.querySelector('link[href*="Material+Symbols+Outlined"]')) {
        const fontLink = document.createElement("link");
        fontLink.rel = "stylesheet";
        fontLink.href = "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0";
        document.head.appendChild(fontLink);
    }

    // --- 4. Inject the HTML for the toggle button ---
    // We wait for DOMContentLoaded to inject the button into the body
    window.addEventListener("DOMContentLoaded", () => {
        // Double check exclusion just in case
        if (EXCLUDED_PAGES.some(page => window.location.pathname.toLowerCase().endsWith(page))) return;

        const toggleBtn = document.createElement("button");
        toggleBtn.id = "global-dark-toggle";
        toggleBtn.setAttribute("aria-label", "Toggle Dark Mode");
        
        // Initial icon based on current state
        const iconSpan = document.createElement("span");
        iconSpan.className = "material-symbols-outlined";
        iconSpan.textContent = isDark ? "light_mode" : "dark_mode"; // Sun icon if dark, Moon icon if light
        toggleBtn.appendChild(iconSpan);

        // Click handler to toggle mode
        toggleBtn.addEventListener("click", () => {
            const currentlyDark = document.documentElement.classList.contains("dark-mode");
            
            if (currentlyDark) {
                // Switch to light mode
                document.documentElement.classList.remove("dark-mode");
                localStorage.setItem("gleam_dark", "0");
                iconSpan.textContent = "dark_mode"; // Moon icon
                // Optional: add a small rotation animation
                iconSpan.style.transform = "rotate(-360deg)";
            } else {
                // Switch to dark mode
                document.documentElement.classList.add("dark-mode");
                localStorage.setItem("gleam_dark", "1");
                iconSpan.textContent = "light_mode"; // Sun icon
                // Optional: add a small rotation animation
                iconSpan.style.transform = "rotate(360deg)";
            }

            // Reset animation transform after it completes so it can run again
            setTimeout(() => {
                iconSpan.style.transition = "none";
                iconSpan.style.transform = "rotate(0deg)";
                // Force reflow
                void iconSpan.offsetWidth;
                iconSpan.style.transition = "transform 0.3s ease";
            }, 300);
        });

        document.body.appendChild(toggleBtn);
    });
})();
