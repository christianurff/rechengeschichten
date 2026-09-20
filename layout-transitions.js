/**
 * Kleine FLIP-Hilfe fuer unterbrechbare Layout-Uebergaenge ohne Abhaengigkeiten.
 * Funktioniert im Browser und exportiert die Geometrie-Helfer fuer Node-Tests.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        root.LayoutTransitions = api;
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const activeAnimations = new WeakMap();
    const defaultOptions = {
        duration: 360,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        fill: 'both'
    };

    function round(value) {
        return Math.round(value * 10000) / 10000;
    }

    function createFlipKeyframes(from, to) {
        const translateX = round(from.left - to.left);
        const translateY = round(from.top - to.top);
        const scaleX = round(from.width / to.width);
        const scaleY = round(from.height / to.height);

        return [
            {
                transform: `translate(${translateX}px, ${translateY}px) scale(${scaleX}, ${scaleY})`,
                transformOrigin: 'top left'
            },
            {
                transform: 'none',
                transformOrigin: 'top left'
            }
        ];
    }

    function createEnterKeyframes() {
        return [
            { opacity: 0, transform: 'translateY(12px) scale(0.985)' },
            { opacity: 1, transform: 'none' }
        ];
    }

    function isValidRect(rect) {
        return !!rect && rect.width > 0 && rect.height > 0;
    }

    function calculateAnchoredBottom(viewportHeight, anchorRect, options = {}) {
        const defaultBottom = Number.isFinite(options.defaultBottom) ? options.defaultBottom : 20;
        const gap = Number.isFinite(options.gap) ? options.gap : 16;

        if (!Number.isFinite(viewportHeight)
            || viewportHeight <= 0
            || !isValidRect(anchorRect)
            || !Number.isFinite(anchorRect.top)
            || anchorRect.top < 0
            || anchorRect.top >= viewportHeight) {
            return defaultBottom;
        }

        return Math.max(defaultBottom, Math.round(viewportHeight - anchorRect.top + gap));
    }

    function positionElementAboveAnchor(element, anchor, options = {}) {
        if (!element?.style || typeof anchor?.getBoundingClientRect !== 'function') {
            return null;
        }

        const viewportHeight = Number.isFinite(options.viewportHeight)
            ? options.viewportHeight
            : (typeof window !== 'undefined' ? window.innerHeight : 0);
        const bottom = calculateAnchoredBottom(
            viewportHeight,
            anchor.getBoundingClientRect(),
            options
        );
        element.style.setProperty('--toast-bottom', `${bottom}px`);
        return bottom;
    }

    function shouldAnimateLayout(from, to) {
        if (!isValidRect(from) || !isValidRect(to)) return false;
        return Math.abs(from.left - to.left) > 0.5
            || Math.abs(from.top - to.top) > 0.5
            || Math.abs(from.width - to.width) > 0.5
            || Math.abs(from.height - to.height) > 0.5;
    }

    function prefersReducedMotion() {
        return typeof window !== 'undefined'
            && typeof window.matchMedia === 'function'
            && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    function uniqueElements(elements) {
        return [...new Set((elements || []).filter((element) =>
            element && typeof element.getBoundingClientRect === 'function'))];
    }

    function capture(elements) {
        const rects = new Map();
        elements.forEach((element) => {
            const rect = element.getBoundingClientRect();
            if (isValidRect(rect)) rects.set(element, rect);
        });
        return rects;
    }

    function stopActiveAnimation(element) {
        const animation = activeAnimations.get(element);
        if (!animation) return;
        animation.cancel();
        activeAnimations.delete(element);
    }

    function startAnimation(element, keyframes, options) {
        if (typeof element.animate !== 'function') return null;
        const animation = element.animate(keyframes, options);
        activeAnimations.set(element, animation);
        animation.finished
            .catch(() => {})
            .finally(() => {
                if (activeAnimations.get(element) === animation) {
                    animation.cancel();
                    activeAnimations.delete(element);
                }
            });
        return animation;
    }

    function animateLayoutChange(elements, mutate, options = {}) {
        const targets = uniqueElements(elements);
        const before = capture(targets);

        // Die aktuelle Bildschirmposition wurde erfasst. Alte FLIP-Animationen
        // koennen nun beendet werden, ohne dass der neue Uebergang springt.
        targets.forEach(stopActiveAnimation);
        const result = mutate();

        const after = capture(targets);
        const reducedMotion = prefersReducedMotion();
        const animationOptions = {
            ...defaultOptions,
            ...options,
            duration: reducedMotion ? 120 : (options.duration || defaultOptions.duration)
        };

        targets.forEach((element) => {
            const from = before.get(element);
            const to = after.get(element);

            if (from && to && !reducedMotion && shouldAnimateLayout(from, to)) {
                startAnimation(element, createFlipKeyframes(from, to), animationOptions);
            } else if (!from && to) {
                const frames = reducedMotion
                    ? [{ opacity: 0 }, { opacity: 1 }]
                    : createEnterKeyframes();
                startAnimation(element, frames, animationOptions);
            }
        });

        return result;
    }

    return {
        animateLayoutChange,
        calculateAnchoredBottom,
        createEnterKeyframes,
        createFlipKeyframes,
        positionElementAboveAnchor,
        shouldAnimateLayout
    };
}));
