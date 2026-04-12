.PHONY: help test sim sim-greedy combo analyze telemetry ngrok version play clean-sessions

help:
	@echo "Available targets:"
	@echo "  test           Run the full test suite"
	@echo "  sim            Smart AI batch (300 runs, seed 42, 30 waves)"
	@echo "  sim-greedy     Greedy AI batch (300 runs, seed 42, 20 waves)"
	@echo "  combo          Combo-pair scan on smart policy (≈4 min)"
	@echo "  analyze        Analyze uploaded telemetry sessions"
	@echo "  telemetry      Start local telemetry sink on :12000"
	@echo "  ngrok          Expose telemetry on the fixed ngrok URL"
	@echo "  version        Regenerate version.json from git HEAD"
	@echo "  play           Open index.html in the default browser"
	@echo "  clean-sessions Remove uploaded telemetry sessions"

test:
	@node tests/test-vector.js \
	  && node tests/test-player.js \
	  && node tests/test-caravan.js \
	  && node tests/test-combat.js \
	  && node tests/test-ui.js \
	  && node tests/test-collision.js \
	  && node tests/test-particles.js \
	  && node tests/test-input.js \
	  && node tests/test-session-logger.js \
	  && node tests/test-simulator.js \
	  && node tests/test-analyze.js

sim:
	node js/sim/run.js --policy smart --count 300 --max-waves 30 --seed 42

sim-greedy:
	node js/sim/run.js --policy greedy --count 300 --max-waves 20 --seed 42

combo:
	node js/sim/run.js --policy smart --combo-scan --count 20 --max-waves 20 --seed 42 --out combo.json

analyze:
	node js/sim/analyze.js telemetry/sessions

telemetry:
	node scripts/telemetry-server.js

ngrok:
	ngrok http --url=rapid-mayfly-intense.ngrok-free.app 12000

version:
	./scripts/update-version.sh

play:
	xdg-open index.html

clean-sessions:
	rm -f telemetry/sessions/*.json
