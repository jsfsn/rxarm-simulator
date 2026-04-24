# RX Mini Arms — Force Curve Simulator

A 2D quasi-static simulator for the [push-n-pull RX Mini Arms](https://push-n-pull.de/en/products/mini-arms).
Model a pivoting lever arm with independent handle and weight extensions, load it
either with plates on the weight horn or with a cable-stack pulling through a
pulley, and plot the resulting force at the handle across the range of motion.

## Run

It's a plain static site — no build step.

```sh
# any static server works; easiest from the project root:
python3 -m http.server 8000
# then open http://localhost:8000
```

(Opening `index.html` via `file://` won't work because the JS uses ES modules.)

## Model

All geometry in the side view, metres, radians.

```
arm rotates by θ about pivot on the rack
handle tip  = pivot + L_h · (cos(θ + α_h),  sin(θ + α_h))
weight tip  = pivot + L_w · (cos(θ + α_w),  sin(θ + α_w))
```

**Torque balance about the pivot.** Load sources:

- **Plate mode** — gravity on plate CoM at the weight-arm tip:
  `τ_plate = -m_plate · g · (x_weight - x_pivot)`
- **Cable mode** — tension `T = m_stack · g · MA` pulling the weight-arm tip
  toward the fixed pulley. The cable unit vector `(û_x, û_y)` changes with θ:
  `τ_cable = r × (T · û)` at the weight-arm tip.
- **Arm self-weight** (optional) — point mass at a fraction of `L_h` along
  the handle arm.

User force is assumed perpendicular to the handle arm (tangential):

```
F_user · L_h = |τ_load|   →   F_user = |τ_load| / L_h
```

This is the classic quasi-static lever equation — valid when velocity is low,
which matches strength-training use.

## What the plot shows

- **Yellow line** — force the user must apply at the handle through the ROM
- **Dashed green** — optional idealised strength curve (ascending, descending,
  bell, flat), scaled to the force peak so the *shape* can be compared
- **X axis toggle** — arm angle (degrees) or handle vertical displacement (cm)
- **Stats** — peak, min, current, min/peak ratio, and handle height

Use the overlay to see how closely a given geometry matches the shape of an
idealised strength curve. For instance:

- Offsetting the **weight-arm angle** away from vertical shifts where peak
  force occurs in the ROM
- Moving the **cable pulley** changes both magnitude and shape
- A short **weight arm** with high MA cable gives a flatter curve than
  long horn + plates

## Caveats

- Quasi-static only; inertia and cable stretch are ignored
- Plate CoM is modelled at the weight-arm tip; real horns offset the CoM
  slightly along the horn axis
- User force is assumed tangential — reality depends on body position
- Cable doesn't check for self-intersection with the arm or rack

Good enough for comparing geometries and picking plate loads; not a
substitute for measuring the real thing.
