# Makefile for slovo-propovedi-docs
#
# Wraps the dev OpenAPI editor (docker compose) and the production Swagger UI
# image (docker) into short targets. Run `make help` to list them.

DEV_COMPOSE := docker compose -f docker-compose.dev.yml
PROD_IMAGE  := slovo-propovedi-docs
PROD_NAME   := slovo-propovedi-docs
PROD_PORT   := 8080
EDITOR_PORT := 8081
SWAGGER_UI_VERSION ?=

.PHONY: help
help: ## Show this list of available targets
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z_-]+:.*## / {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

## ---- Dev OpenAPI editor ----

.PHONY: dev-up
dev-up: ## Build and start the dev editor, then open it in your browser (http://localhost:8081)
	$(DEV_COMPOSE) up -d --build
	@echo "Waiting for http://localhost:$(EDITOR_PORT) to come up..."
	@for i in $$(seq 1 30); do \
		if curl -fsS -o /dev/null http://localhost:$(EDITOR_PORT)/; then \
			xdg-open http://localhost:$(EDITOR_PORT) >/dev/null 2>&1 || true; \
			echo "OpenAPI editor ready - opening http://localhost:$(EDITOR_PORT) in your browser."; \
			exit 0; \
		fi; \
		sleep 1; \
	done; \
	echo "Editor did not become ready in 30s. Check 'make dev-logs', then run 'make dev-open'."; \
	exit 1

.PHONY: dev-down
dev-down: ## Stop and remove the dev editor container
	$(DEV_COMPOSE) down

.PHONY: dev-restart
dev-restart: ## Restart the dev editor (picks up openAPI.yaml changed outside the editor, e.g. git pull)
	$(DEV_COMPOSE) restart

.PHONY: dev-build
dev-build: ## (Re)build the dev editor image without starting
	$(DEV_COMPOSE) build

.PHONY: dev-logs
dev-logs: ## Tail dev editor logs (Ctrl+C to exit)
	$(DEV_COMPOSE) logs -f --tail=100

.PHONY: dev-shell
dev-shell: ## Open a shell inside the running dev editor container
	$(DEV_COMPOSE) exec openapi-editor sh

.PHONY: dev-open
dev-open: ## Open the dev editor in the default browser
	@xdg-open http://localhost:$(EDITOR_PORT) >/dev/null 2>&1 || true

## ---- Production (read-only Swagger UI) ----

.PHONY: prod-build
prod-build: ## Build the production Swagger UI image (override: make prod-build SWAGGER_UI_VERSION=5.40.0)
	docker build $(if $(SWAGGER_UI_VERSION),--build-arg SWAGGER_UI_VERSION=$(SWAGGER_UI_VERSION)) -t $(PROD_IMAGE) .

.PHONY: prod-up
prod-up: ## Run the production container (detached) → http://localhost:8080
	docker run -d --rm --name $(PROD_NAME) -p $(PROD_PORT):8080 $(PROD_IMAGE)

.PHONY: prod-down
prod-down: ## Stop (and auto-remove) the production container
	docker stop $(PROD_NAME) 2>/dev/null || true

.PHONY: prod-logs
prod-logs: ## Tail production logs (Ctrl+C to exit)
	docker logs -f $(PROD_NAME)

.PHONY: clean
clean: ## Stop everything (dev + prod)
	$(DEV_COMPOSE) down; docker stop $(PROD_NAME) 2>/dev/null || true
