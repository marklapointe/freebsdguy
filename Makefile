# Makefile for MDWeb
.PHONY: all build run clean install-deps

all: build

install-deps:
	npm install

build: install-deps
	npm run build

run:
	npm start

run-dev:
	npm run dev

clean:
	rm -rf dist node_modules tests/tmp artifacts
