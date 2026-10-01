import { useEffect, useRef } from "react";
import * as THREE from "three";

export function ShaderAnimation() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<{
    camera: THREE.Camera;
    scene: THREE.Scene;
    renderer: THREE.WebGLRenderer;
    uniforms: any;
    animationId: number;
  } | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;

    // Vertex shader
    const vertexShader = `
      void main() {
        gl_Position = vec4( position, 1.0 );
      }
    `;

    // Fragment shader - blurple energy lines with soft glow falloff
    const fragmentShader = `
      #define TWO_PI 6.2831853072
      #define PI 3.14159265359

      precision highp float;
      uniform vec2 resolution;
      uniform float time;

      void main(void) {
        vec2 uv = (gl_FragCoord.xy * 2.0 - resolution.xy) / min(resolution.x, resolution.y);
        float t = time*0.04;
        float lineWidth = 0.0022;

        vec3 color = vec3(0.0);
        for(int j = 0; j < 3; j++){
          for(int i=0; i < 5; i++){
            color[j] += lineWidth*float(i*i) / abs(fract(t - 0.01*float(j)+float(i)*0.01)*5.0 - length(uv) + mod(uv.x+uv.y, 0.2));
          }
        }

        // monochrome: clean white lines, neutral glow, fade at the edges
        vec3 tint = vec3(1.0);
        float glow = 0.22 * exp(-2.2 * dot(uv, uv));
        float vignette = smoothstep(1.9, 0.4, length(uv));
        vec3 col = color * tint * 1.6 + vec3(glow);
        gl_FragColor = vec4(col * vignette, 1.0);
      }
    `;

    // Initialize Three.js scene
    const camera = new THREE.Camera();
    camera.position.z = 1;

    const scene = new THREE.Scene();
    const geometry = new THREE.PlaneGeometry(2, 2);

    const uniforms = {
      time: { type: "f", value: 1.0 },
      resolution: { type: "v2", value: new THREE.Vector2() },
    };

    const material = new THREE.ShaderMaterial({
      uniforms: uniforms,
      vertexShader: vertexShader,
      fragmentShader: fragmentShader,
    });

    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));

    container.appendChild(renderer.domElement);

    // Handle window resize
    const onWindowResize = () => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      renderer.setSize(width, height);
      uniforms.resolution.value.x = renderer.domElement.width;
      uniforms.resolution.value.y = renderer.domElement.height;
    };

    // Initial resize
    onWindowResize();
    window.addEventListener("resize", onWindowResize, false);

    // Pause rendering while the canvas is not visible: no GPU burn
    // on hidden tabs, minimized windows, or scrolled-away layers
    let raf = 0;
    let inView = true;
    let pageVisible = document.visibilityState === "visible";
    let focused = document.hasFocus();
    const shouldRun = () => inView && pageVisible && focused;
    const stop = () => {
      if (raf !== 0) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };
    const start = () => {
      if (raf !== 0 || !shouldRun()) return;
      const loop = () => {
        raf = requestAnimationFrame(loop);
        uniforms.time.value += 0.05;
        renderer.render(scene, camera);
      };
      raf = requestAnimationFrame(loop);
    };
    const refresh = () => (shouldRun() ? start() : stop());
    const onVisibilityChange = () => {
      pageVisible = document.visibilityState === "visible";
      refresh();
    };
    const onBlur = () => {
      focused = false;
      stop();
    };
    const onFocus = () => {
      focused = true;
      refresh();
    };
    const io = new IntersectionObserver(
      ([entry]) => {
        inView = entry?.isIntersecting ?? true;
        refresh();
      },
      { threshold: 0 },
    );
    io.observe(container);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);

    // Store scene references for cleanup
    sceneRef.current = {
      camera,
      scene,
      renderer,
      uniforms,
      animationId: 0,
    };

    // Start animation (only while visible)
    start();

    // Cleanup function
    return () => {
      stop();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("resize", onWindowResize);

      if (sceneRef.current) {
        if (container && sceneRef.current.renderer.domElement) {
          container.removeChild(sceneRef.current.renderer.domElement);
        }

        sceneRef.current.renderer.dispose();
        geometry.dispose();
        material.dispose();
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "100%",
        background: "#000",
        overflow: "hidden",
      }}
    />
  );
}
