# Makefile for FreeBSD Guy Website

.PHONY: all build run clean install-deps

all: build

install-deps:
	npm install

build: install-deps
	npm run build

run:
	npm start & npm run preview

run-server:
	npm start

clean:
	rm -rf dist node_modules
