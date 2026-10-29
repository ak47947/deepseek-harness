# Short names for enterprise Desktop and build commands. The package.json
# scripts they call stay the source of truth; docs/development.md documents both.
.DEFAULT_GOAL := help
.PHONY: help build clean desktop dev-desktop

PNPM ?= pnpm
ARGS ?=

help:
	@echo "make build        pnpm run build           complete repository build"
	@echo "make clean        pnpm run clean           remove build outputs and safe deleted-package residue"
	@echo "make desktop      pnpm run start:desktop   launch the built Desktop artifacts"
	@echo "make dev-desktop  pnpm run dev:desktop     build, then launch Desktop"

build:
	$(PNPM) run build

clean:
	$(PNPM) run clean

desktop:
	$(PNPM) run start:desktop $(ARGS)

dev-desktop:
	$(PNPM) run dev:desktop $(ARGS)
