# Aforo — entry points for the whole team.
# Targets marked TODO are placeholders owned by the Platform front (see docs/runbooks/).

SHELL := /bin/bash
PROJECT ?= aforo-dev-teamf
REGION  ?= southamerica-east1
SERVICES := gateway catalog queue orders inventory
CONTRACTS := $(SERVICES) mock-payment-gateway prewarmer
PRISM_PORT ?= 4010

.DEFAULT_GOAL := help

.PHONY: help
help: ## List targets
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

## ---- Contracts ----------------------------------------------------------

.PHONY: mock
mock: ## Prism mock of a contract: make mock SERVICE=inventory
	@test -n "$(SERVICE)" || (echo "usage: make mock SERVICE=<$(CONTRACTS)>" && exit 1)
	npx --yes @stoplight/prism-cli@5.16.0 mock -p $(PRISM_PORT) contracts/openapi/$(SERVICE).yaml

.PHONY: lint-contracts
lint-contracts: ## Lint every OpenAPI file
	npx --yes @redocly/cli@1 lint $(foreach s,$(CONTRACTS),contracts/openapi/$(s).yaml)

## ---- Environment (Platform front) ---------------------------------------
# Runtime switches live in Terraform (ADR-0004). Every target reads the current values back from
# state and passes all of them, changing only its own, so no apply flips a switch by accident.
# Never run `terraform apply` by hand.

TF_DIR := infra/envs/dev
TF     := terraform -chdir=$(TF_DIR)
TF_APPLY_FLAGS ?=
TF_PLAN_FLAGS ?=

# Current value of switch $(1) from state, or default $(2) when the output doesn't exist yet.
tf_switch = $(or $(shell $(TF) output -raw switch_$(1) 2>/dev/null),$(2))
CUR_ENV_ON = $(call tf_switch,env_on,false)
CUR_REDIS  = $(call tf_switch,redis_enabled,false)
CUR_FAULT  = $(call tf_switch,mock_fault_mode,none)

# $(1) env_on · $(2) redis_enabled · $(3) mock_fault_mode
tf_apply = $(TF) apply -input=false $(TF_APPLY_FLAGS) -var env_on=$(1) -var redis_enabled=$(2) -var mock_fault_mode=$(3)

.PHONY: tf-init tf-state
tf-init:
	@$(TF) init -input=false >/dev/null

# Fails if the state can't be read, so switches never fall back to defaults by mistake.
tf-state: tf-init
	@$(TF) output -json >/dev/null

.PHONY: status
status: tf-state ## Show the runtime switches (env_on, redis_enabled, mock_fault_mode)
	@echo "env_on=$(CUR_ENV_ON) redis_enabled=$(CUR_REDIS) mock_fault_mode=$(CUR_FAULT)"

.PHONY: plan
plan: tf-state ## terraform plan for dev with the current switches
	$(TF) plan -input=false $(TF_PLAN_FLAGS) -var env_on=$(CUR_ENV_ON) -var redis_enabled=$(CUR_REDIS) -var mock_fault_mode=$(CUR_FAULT)

.PHONY: apply
apply: tf-state ## Apply infra changes, keeping the current switches
	$(call tf_apply,$(CUR_ENV_ON),$(CUR_REDIS),$(CUR_FAULT))

.PHONY: up
up: tf-state ## Turn dev on (Cloud SQL, housekeeping jobs) and run the seed. Keeps Redis as it is
	$(call tf_apply,true,$(CUR_REDIS),$(CUR_FAULT))
	$(MAKE) seed

.PHONY: down
down: tf-state ## Turn everything off (Cloud SQL, Memorystore, fault reset). Announce it first!
	$(call tf_apply,false,false,none)

.PHONY: redis-up
redis-up: tf-state ## Create Memorystore for live tests/demos (~10 min), then re-run the seed (ADR-0001)
	$(call tf_apply,true,true,$(CUR_FAULT))
	$(MAKE) seed

.PHONY: redis-down
redis-down: tf-state ## Destroy Memorystore; the rest stays as it is
	$(call tf_apply,$(CUR_ENV_ON),false,$(CUR_FAULT))

.PHONY: seed
seed: ## Run the idempotent catalog seed against dev — TODO
	@echo "WARNING: seed not implemented yet (TODO(catalog): services/catalog/seed); skipping"

FUNCTIONS := dlq-monitor prewarmer mock-payment-gateway

.PHONY: deploy
deploy: ## Deploy one unit from main through CI (immutable artifact, blue/green): make deploy SERVICE=gateway
	@case "$(SERVICE)" in \
	  gateway|catalog|queue|orders|inventory) WF=service-$(SERVICE).yml ;; \
	  web) WF=web.yml ;; \
	  dlq-monitor|prewarmer|mock-payment-gateway) WF=function-$(SERVICE).yml ;; \
	  *) echo "usage: make deploy SERVICE=<$(SERVICES) web $(FUNCTIONS)>"; exit 1 ;; \
	esac; \
	gh workflow run "$$WF" --ref main && sleep 5 && \
	RUN=$$(gh run list --workflow "$$WF" --event workflow_dispatch --limit 1 --json databaseId -q '.[0].databaseId') && \
	echo "Deploying $(SERVICE) from main: $$(gh run view $$RUN --json url -q .url)" && \
	gh run watch "$$RUN" --exit-status

.PHONY: fault
fault: tf-state ## Fault injection on the mock payment gateway (Terraform switch, ~1 min): make fault MODE=<none|error|timeout>
	@case "$(MODE)" in none|error|timeout) ;; *) echo "usage: make fault MODE=<none|error|timeout>"; exit 1;; esac
	$(call tf_apply,$(CUR_ENV_ON),$(CUR_REDIS),$(MODE))

.PHONY: poison
poison: ## Publish an invalid message to demo DLQ + dlq-monitor alert (E-05): make poison TOPIC=aforo.catalog.event-published
	@test -n "$(TOPIC)" || (echo "usage: make poison TOPIC=<topic>" && exit 1)
	@CID=$$(uuidgen | tr 'A-Z' 'a-z'); \
	gcloud pubsub topics publish "$(TOPIC)" --project "$(PROJECT)" --message 'not-an-envelope' \
	  --attribute "type=Poison,correlationId=$$CID" >/dev/null && \
	echo "Published poison message, correlationId=$$CID. It dead-letters after 5 attempts (~2-3 min); then search Cloud Logging for jsonPayload.correlationId=\"$$CID\"."
