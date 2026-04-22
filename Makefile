# Makefile for MDWeb
.PHONY: all build run clean install-deps package-port package

all: build

package: package-port

package-port:
	@echo "Packaging FreeBSD port..."
	cd ports/www/MDWeb && make package

install-deps:
	npm install

build: install-deps
	npm run build

run:
	npm start

run-dev:
	npm run dev

clean:
	rm -rf dist node_modules mdweb.rc mdweb.1
