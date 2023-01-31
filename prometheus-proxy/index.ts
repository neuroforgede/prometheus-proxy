import express from 'express';
import morgan from 'morgan';
import cors from 'cors';
import client from 'prom-client';
import axios from 'axios';
import { resolve4 } from 'node:dns/promises';
import fs from 'fs';

const DEBUG = process.env.DEBUG == 'true';

const collectDefaultMetrics = client.collectDefaultMetrics;
const Registry = client.Registry;
const metricsRegistry = new Registry();
collectDefaultMetrics({ register: metricsRegistry });

const fetchErrors = new client.Counter({
    name: 'prometheus_proxy_fetch_errors',
    help: 'Error count',
    labelNames: ['proxy_error_instance', 'proxy_error_job']
});
metricsRegistry.registerMetric(fetchErrors);

const app = express();

// just allow all origins
app.use(cors());
if(DEBUG) {
    app.use(morgan('combined'));
}

app.get('/healthz', function (req, res) {
    res.send('I am happy and healthy\n');
});

const regexWithLabels = new RegExp(/^(\w+)\{(.*)\}\s+(.*)$/, 'gm');
const regexWithoutLabels = new RegExp(/^(\w+)\s+(.*)$/, 'gm');

type Config = {
    apps: {
        job_name: string,
        dns_sd_configs: {
            names: string[],
            type: 'A',
            port: string | number
        }[],
        metrics_path?: string
    }[]
};

let config: Config;
let configContent: string;
if(process.env.PROMETHEUS_PROXY_CONFIG_FILE) {
    configContent = fs.readFileSync(process.env.PROMETHEUS_PROXY_CONFIG_FILE).toString();
} else {
    configContent = process.env.PROMETHEUS_PROXY_CONFIG ?? '{ "apps": [] }'
}
config = JSON.parse(configContent);

app.get('/', async (req, res) => {
    try {
        res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
        res.status(200);

        const promises: Promise<string>[] = [];

        for (const app of config.apps) {
            try {
                const instances = new Set<string>();
                for (const dnsSdConfig of app.dns_sd_configs) {
                    for (const name of dnsSdConfig.names) {
                        const dnsResult = await resolve4(name);
                        for (const ip of dnsResult) {

                            const instance = `${ip}:${dnsSdConfig.port}`;
                            instances.add(instance);
                        }
                    }
                }
                const metricsPath = app.metrics_path ?? '/metrics';

                for (const instance of instances) {
                    promises.push((async () => {
                        try {
                            const remoteMetrics = await axios.get(`http://${instance}${metricsPath}`);
                            const response: string = remoteMetrics.data;
    
                            const augmented =
                                response.replace(regexWithLabels, `$1{proxy_instance="${instance}",proxy_job="${app.job_name}",$2} $3`)
                                    .replace(regexWithoutLabels, `$1{proxy_instance="${instance}",proxy_job="${app.job_name}"} $2`);
                            return augmented;
                        } catch (error) {
                            console.error(JSON.stringify(error));
                            fetchErrors.labels({
                                proxy_error_job: app.job_name,
                                proxy_error_instance: instance
                            }).inc();
                        }
                        return "";
                    })());                    
                }
            } catch (error) {
                console.error(JSON.stringify(error));
                fetchErrors.labels({
                    proxy_error_job: app.job_name
                }).inc();
            }
        }

        const responses = await Promise.all(promises);
        res.send(responses.join('\n'));

        res.end();
    } catch (error) {
        console.error(error);
        res.sendStatus(500);
        res.end();
    }
});
export default app;


export const metricsApp = express();

// just allow all origins
metricsApp.use(cors());
if(DEBUG) {
    metricsApp.use(morgan('combined'));
}
// these are our own metrics
metricsApp.get('/metrics', (req, res) => {
    metricsRegistry.metrics().then((metrics) => {
        res.setHeader('Content-Type', metricsRegistry.contentType);
        res.end(metrics);
    }).catch(() => {
        res.sendStatus(500);
        res.end()
    });
});
