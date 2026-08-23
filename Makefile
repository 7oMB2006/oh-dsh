SHELL := /bin/sh

PNPM ?= pnpm
NODE ?= node
ARGS ?=
OH_DSH_HOME ?= $(HOME)/.ohdsh

export OH_DSH_HOME

TUI_ENTRY := upstream/dsh-TUI/lib/types/index.js

.DEFAULT_GOAL := build
.PHONY: build upstream stage stage-desktop stage-web stage-tui tui web desktop

build: upstream
	$(PNPM) run build

upstream:
	@if [ ! -f "upstream/DSH-better-sidebar/src/index.ts" ] \
		|| [ ! -f "upstream/dsh-TUI/package.json" ]; then \
		git submodule update --init --recursive upstream/DSH-better-sidebar upstream/dsh-TUI; \
	fi
	@if [ ! -f "$(TUI_ENTRY)" ]; then \
		$(PNPM) --dir upstream/dsh-TUI install --frozen-lockfile --ignore-scripts; \
		$(PNPM) --dir upstream/dsh-TUI run compile; \
	fi

stage: build
	$(PNPM) run stage:dsh

stage-desktop: build
	$(PNPM) run stage:dsh -- --surface desktop

stage-web: build
	$(PNPM) run stage:dsh -- --surface web

stage-tui: build
	$(PNPM) run stage:dsh -- --surface tui

tui: stage-tui
	$(NODE) dist/ohdsh.js tui --inline $(ARGS)

web: stage-web
	$(NODE) dist/web.js $(ARGS)

desktop: stage-desktop
	$(PNPM) exec electron . $(ARGS)
