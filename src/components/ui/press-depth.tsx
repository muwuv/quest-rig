import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, MouseEventHandler, PointerEvent, ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";

const PRESS = {
  type: "spring",
  stiffness: 520,
  damping: 34,
  mass: 0.45,
} as const;

export type UsePressDepthOptions = {
  disabled?: boolean;
  onPressStart?: () => void;
  onPressEnd?: () => void;
};

export type PressOrigin = { x: number; y: number };

export type UsePressDepthResult = {
  pressed: boolean;
  origin: PressOrigin | null;
  ref: (node: HTMLElement | null) => void;
  bind: {
    onPointerDown: (event: PointerEvent<HTMLElement>) => void;
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
    onKeyUp: (event: KeyboardEvent<HTMLElement>) => void;
    onBlur: () => void;
  };
};

export function usePressDepth(options: UsePressDepthOptions = {}): UsePressDepthResult {
  const { disabled = false, onPressStart, onPressEnd } = options;

  const [pressed, setPressed] = useState(false);
  const [tracking, setTracking] = useState(false);
  const [origin, setOrigin] = useState<PressOrigin | null>(null);

  const node = useRef<HTMLElement | null>(null);
  const pointer = useRef<number | null>(null);
  const down = useRef(false);

  const began = useRef(onPressStart);
  began.current = onPressStart;
  const ended = useRef(onPressEnd);
  ended.current = onPressEnd;

  const setDown = useCallback((next: boolean) => {
    if (down.current === next) return;
    down.current = next;
    setPressed(next);
    if (next) began.current?.();
    else ended.current?.();
  }, []);

  const stop = useCallback(() => {
    pointer.current = null;
    setTracking(false);
    setOrigin(null);
    setDown(false);
  }, [setDown]);

  useEffect(() => {
    if (!tracking) return;

    const contains = (event: globalThis.PointerEvent) => {
      const el = node.current;
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return (
        event.clientX >= r.left &&
        event.clientX <= r.right &&
        event.clientY >= r.top &&
        event.clientY <= r.bottom
      );
    };

    const move = (event: globalThis.PointerEvent) => {
      if (event.pointerId !== pointer.current) return;
      setDown(contains(event));
    };
    const lift = (event: globalThis.PointerEvent) => {
      if (event.pointerId !== pointer.current) return;
      stop();
    };
    const bail = () => stop();
    const hidden = () => {
      if (document.hidden) stop();
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", lift);
    window.addEventListener("pointercancel", lift);
    window.addEventListener("blur", bail);
    document.addEventListener("visibilitychange", hidden);

    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", lift);
      window.removeEventListener("pointercancel", lift);
      window.removeEventListener("blur", bail);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [tracking, setDown, stop]);

  useEffect(() => {
    if (disabled) stop();
  }, [disabled, stop]);

  const ref = useCallback((next: HTMLElement | null) => {
    node.current = next;
  }, []);

  const bind = {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (disabled) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      const r = event.currentTarget.getBoundingClientRect();
      setOrigin({
        x: Math.max(-1, Math.min(1, ((event.clientX - r.left) / r.width) * 2 - 1)),
        y: Math.max(-1, Math.min(1, ((event.clientY - r.top) / r.height) * 2 - 1)),
      });
      pointer.current = event.pointerId;
      setTracking(true);
      setDown(true);
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (disabled || event.repeat) return;
      if (event.key === " " || event.key === "Enter") setDown(true);
    },
    onKeyUp: (event: KeyboardEvent<HTMLElement>) => {
      if (event.key === " " || event.key === "Enter" || event.key === "Escape") {
        setDown(false);
      }
    },
    onBlur: () => stop(),
  };

  return { pressed, origin, ref, bind };
}

export type PressDepthVariant = "primary" | "secondary" | "success";
export type PressDepthJoin = "none" | "left" | "right";

export type PressDepthProps = {
  children: ReactNode;
  variant?: PressDepthVariant;
  depth?: number;
  tilt?: number;
  faceHeight?: number;
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
  onClick?: MouseEventHandler<HTMLButtonElement>;
  className?: string;
  style?: CSSProperties;
  title?: string;
  ariaLabel?: string;
  block?: boolean;
  icon?: boolean;
  join?: PressDepthJoin;
};

export function PressDepth({
  children,
  variant = "secondary",
  depth = 4,
  tilt = 7,
  faceHeight = 34,
  disabled = false,
  type = "button",
  onClick,
  className = "",
  style,
  title,
  ariaLabel,
  block = false,
  icon = false,
  join = "none",
}: PressDepthProps) {
  const reduced = useReducedMotion();
  const { pressed, origin, ref, bind } = usePressDepth({ disabled });

  const lean = pressed && origin && !reduced ? origin : null;

  const cls = [
    "pd",
    `pd-${variant}`,
    block ? "pd-block" : "",
    icon ? "pd-icon" : "",
    join !== "none" ? `pd-join-${join}` : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      ref={ref as (node: HTMLButtonElement | null) => void}
      type={type}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      data-pressed={pressed ? "" : undefined}
      onClick={onClick}
      style={{
        paddingBottom: depth,
        touchAction: "manipulation",
        WebkitTapHighlightColor: "transparent",
        ...style,
        ["--pd-depth" as string]: `${depth}px`,
        ["--pd-face-h" as string]: `${faceHeight}px`,
      }}
      className={cls}
      {...bind}
    >
      <span aria-hidden className="pd-base" style={{ top: depth }} />
      <motion.span
        initial={false}
        animate={{
          y: pressed ? depth : 0,
          rotateX: lean ? -lean.y * tilt : 0,
          rotateY: lean ? lean.x * tilt : 0,
        }}
        transition={reduced ? { duration: 0 } : PRESS}
        style={{ transformPerspective: 340 }}
        className="pd-face"
      >
        <motion.span
          aria-hidden
          initial={false}
          animate={{ opacity: pressed ? 0 : 1 }}
          transition={reduced ? { duration: 0 } : PRESS}
          className="pd-gloss"
        />
        {children}
      </motion.span>
    </button>
  );
}

export default PressDepth;
