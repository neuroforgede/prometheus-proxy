# Prometheus Proxy

This is a proxy for use with prometheus that serves as a simple entrypoint that allows for proxying requests to other
services (that are discovered via dns sd). This is particularly useful in Docker Swarm setups where you don't want
to break network segregation just because you need to scrape prometheus metrics.

The idea is to have one prometheus-proxy running in every docker network that needs scraping. The prometheus-proxy
then is the only service that is part of a shared monitoring network with prometheus. This way only the prometheus-proxies
can see each other but not the services, keeping network segregation intact.

Proudly made by [NeuroForge](https://neuroforge.de/) in Bayreuth, Germany.

## Use in a Docker Swarm deployment

Deploy:

```yaml
version: "3.8"

services:
  prometheus-proxy:
    image: ghcr.io/neuroforgede/prometheus-proxy:0.2.0
    networks:
      - net
    environment:
      # proxy our own metrics as an example
      PROMETHEUS_PROXY_CONFIG: |
        {
            "apps": [
                {
                    "job_name": "prometheus-proxy",
                    "dns_sd_configs": [
                        {
                            "names": ["tasks.prometheus-proxy"],
                            "type": "A",
                            "port": "4000"
                        }
                    ],
                    "metrics_path": "/metrics"
                }
            ],
            "proxy_group": "{{index .Service.Labels "com.docker.stack.namespace"}}"
        }
    deploy:
      mode: replicated
      replicas: 1
      resources:
        limits:
          memory: 256M
        reservations:
          memory: 128M
```

prometheus.yml

```yaml
# ...
scrape_configs:
  - job_name: 'prometheus-proxy'
    dns_sd_configs:
    - names:
      - 'tasks.prometheus-proxy'
      type: 'A'
      port: 3000
```

A monitoring solution based on the original swarmprom that includes this can be found at our [Swarmsible repo](https://github.com/neuroforgede/swarmsible/tree/master/environments/test/test-swarm/stacks/02_monitoring)