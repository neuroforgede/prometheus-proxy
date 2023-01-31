import express from 'express';
import morgan from 'morgan';
import cors from 'cors';
import client from 'prom-client';
import axios from 'axios';
import { resolve4 } from 'node:dns/promises';
import fs from 'fs';

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
app.use(morgan('combined'));

app.get('/healthz', function (req, res) {
    res.send('I am happy and healthy\n');
});

const regexWithLabels = new RegExp(/^(\w+)\{(.*)\}\s+(.*)$/, 'gm');
const regexWithoutLabels = new RegExp(/^(\w+)\s+(.*)$/, 'gm');

type Config ={
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
const configContent = fs.readFileSync(process.env.CONFIG_FILE ?? (__dirname + '/config.json')).toString();
config = JSON.parse(configContent);

app.get('/proxy', async (req, res) => {
    try {
        res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
        res.status(200);

        for (const app of config.apps) {
            try{
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
                const metricsPath = app.metrics_path ?? '/metrics'
                for (const instance of instances) {
                    try {
                        const remoteMetrics = await axios.get(`http://${instance}${metricsPath}`);
                        const response: string = remoteMetrics.data;

                        const augmented =
                            response.replace(regexWithLabels, `$1{proxy_instance="${instance}",proxy_job="${app.job_name}",$2} $3`)
                                .replace(regexWithoutLabels, `$1{proxy_instance="${instance}",proxy_job="${app.job_name}"} $2`);
                        res.send(augmented);
                    } catch(error) {
                        console.error(JSON.stringify(error));
                        fetchErrors.labels({
                            proxy_error_job: app.job_name,
                            proxy_error_instance: instance
                        }).inc();
                    }
                }
            } catch(error) {
                console.error(JSON.stringify(error));
                fetchErrors.labels({
                    proxy_error_job: app.job_name
                }).inc();
            }
        }
        res.end();
    } catch (error) {
        console.error(error);
        res.sendStatus(500);
        res.end();
    }
});


// these are our own metrics
app.get('/metrics', (req, res) => {
    metricsRegistry.metrics().then((metrics) => {
        res.setHeader('Content-Type', metricsRegistry.contentType);
        res.end(metrics);
    }).catch(() => {
        res.sendStatus(500);
        res.end()
    });
});

export default app;