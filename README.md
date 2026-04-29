# RX Mini Arms — Force Curve Simulator

A 2D quasi-static simulator for the [push-n-pull RX Mini Arms](https://push-n-pull.de/en/products/mini-arms).
Model a pivoting lever arm with independent handle and weight extensions, load it
with plates, a cable-stack, or a programmable Voltra-style cable source, and
plot the resulting force at the handle across the range of motion.

## Run

It's a plain static site — no build step.

```sh
# any static server works; easiest from the project root:
python3 -m http.server 8000
# then open http://localhost:8000
```

(Opening `index.html` via `file://` won't work because the JS uses ES modules.)

## Share Configs

The **Share config** panel stores the current simulator setup as a compact
`rx1.` string. Paste the string back into the same field and press **Load** to
restore it. Shared URLs can also use `#cfg=<rx1-string>`.

## Test

The project has a small Node test suite for the core geometry and torque
invariants. It has no third-party dependencies.

```sh
npm test
```

## Model

The mechanism is a single rigid body rotating about the rack pivot:

- **Main arm** (length `L_arm`) from the rack pivot to the handle bracket
- **Weight bracket** sits at distance `L_wm` along the main arm; from it
  the **weight arm** (length `L_w`) extends at a fixed angle `α_w` relative
  to the main arm (the bracket is indexable 360° on the real hardware)
- **Handle bracket** at the far end of the main arm; the **handle arm**
  (length `L_h`) extends at a fixed angle `α_h` relative to the main arm

When the user pulls/presses the handle, the entire assembly rotates by `θ`
about the rack pivot. The sub-arm angles `α_h` and `α_w` don't change during
the rep — they're locked in by the indexable dials.

```
handle bracket  = pivot + L_arm · (cos θ,            sin θ)
weight bracket  = pivot + L_wm  · (cos θ,            sin θ)
handle tip      = bracket_h + L_h · (cos(θ + α_h),   sin(θ + α_h))
weight tip      = bracket_w + L_w · (cos(θ + α_w),   sin(θ + α_w))
```

**Torque balance about the rack pivot.** Load sources:

- **Plate mode** — gravity at the weight tip:
  `τ_plate = -m_plate · g · (x_weight_tip - x_pivot)`
- **Cable mode** — tension `T = m_stack · g · MA` pulling the weight tip
  toward a fixed pulley; direction changes with θ.
- **Voltra 1 mode** — idealised programmable cable-force source. The editable
  control points define the pulling force from the Voltra; the machine geometry
  then transforms that variable source force into the plotted handle force.
- **Arm self-weight** — point mass at a fraction of `L_arm` along the main arm.

User force is applied in the selected direction at the handle. For any unit
force direction `F̂`, its effective handle lever is the scalar cross product:

```
R_eff = (r_handle × F̂)_z
F_user = |τ_load / R_eff|
```

For near-singular geometries where `R_eff ≈ 0`, the UI caps the displayed
force instead of letting the plot go infinite. If load torque is zero, required
handle force remains zero even in a singular direction.

In the default body-relative modes the effective lever is constant through the
ROM, so the force direction changes magnitude but not curve shape:

- **Tangent** — minimum force, `R_eff = R_h`
- **Perpendicular to main arm** — `R_eff = L_arm + L_h · cos α_h`
- **Perpendicular to handle arm** — `R_eff = L_arm · cos α_h + L_h`

The tangent handle radius comes from the law of cosines:

```
R_h = √( L_arm² + L_h² + 2·L_arm·L_h · cos α_h )
```

World-fixed horizontal/vertical force directions use the same `R_eff` equation,
but `R_eff` varies with `θ`, so they can reshape the force curve.

Quasi-static — velocity and inertia ignored, which is fine for strength work.

## What the plot shows

- **Yellow line** — force the user must apply at the handle through the ROM
- **Blue handles in Voltra mode** — draggable control points for the Voltra
  source-force curve
- **Scene handles** — draggable anchors for pivot height, current arm angle,
  handle/weight bracket rotation, cable/Voltra position, and bench placement
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
- User force direction is simplified — real force paths depend on grip,
  shoulder position, and user intent
- Cable doesn't check for self-intersection with the arm or rack

Good enough for comparing geometries and picking plate loads; not a
substitute for measuring the real thing.
