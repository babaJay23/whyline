Re-record the demos with [vhs](https://github.com/charmbracelet/vhs), from the repo root:

    for t in demo/*.tape; do WHYLINE_DEMO_SETUP=$PWD/demo/setup.sh vhs $t; done

Each tape builds the same scenario (`setup.sh`) in a temp directory and records one feature.
