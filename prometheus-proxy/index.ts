import express from 'express';
import morgan from 'morgan';
import cors from 'cors';
import client from 'prom-client';
import axios from 'axios';
import { resolve4 } from 'node:dns/promises';

const app = express();

// just allow all origins
app.use(cors());
app.use(morgan('combined'));

app.get('/healthz', function (req, res) {
    res.send('I am happy and healthy\n');
});

const regexWithAttributes = new RegExp(/^(\w+)\{(.*)\}\s+(.*)$/, 'gm');
const regexWithoutAttributes = new RegExp(/^(\w+)\s+(.*)$/, 'gm');

const config: {
    apps: {
        job_name: string,
        dns_sd_configs: {
            names: string[],
            type: 'A',
            port: string | number
        }[],
        metrics_path?: string
    }[]
} = {
    apps: [
        {
            job_name: 'prometheus-proxy',
            dns_sd_configs: [
                {
                    names: ['prometheus-proxy'],
                    type: 'A',
                    port: '3000'
                },
                {
                    names: ['prometheus-proxy.local'],
                    type: 'A',
                    port: '3000'
                }
            ],
            metrics_path: '/metrics'
        }
    ]
}

app.get('/proxy', async (req, res) => {
    try {
        res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
        res.status(200);

        for (const app of config.apps) {
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
                const remoteMetrics = await axios.get(`http://${instance}${metricsPath}`);
                const response: string = remoteMetrics.data;

                const augmented =
                    response.replace(regexWithAttributes, `$1{proxy_instance="${instance}",proxy_job="${app.job_name}",$2} $3`)
                        .replace(regexWithoutAttributes, `$1{proxy_instance="${instance}",proxy_job="${app.job_name}"} $2`);
                res.send(augmented);
            }
        }
        res.end();
    } catch (error) {
        console.error(error);
        res.sendStatus(500);
        res.end();
    }
});

const collectDefaultMetrics = client.collectDefaultMetrics;
const Registry = client.Registry;
const metricsRegistry = new Registry();
collectDefaultMetrics({ register: metricsRegistry });

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