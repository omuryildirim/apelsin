import * as path from "path";
import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as apigwv2_integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as apigwv2_authorizers from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import type { Construct } from "constructs";

export class ApelsinStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ── DynamoDB tables ──────────────────────────────────────────────────────

    const connectionsTable = new dynamodb.Table(this, "Connections", {
      tableName: "ApelsinConnections",
      partitionKey: { name: "connectionId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "ttl",
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    connectionsTable.addGlobalSecondaryIndex({
      indexName: "email-index",
      partitionKey: { name: "email", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    const messagesTable = new dynamodb.Table(this, "Messages", {
      tableName: "ApelsinMessages",
      partitionKey: { name: "chatId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "ttl",
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const usersTable = new dynamodb.Table(this, "Users", {
      tableName: "ApelsinUsers",
      partitionKey: { name: "email", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    
    const contactsTable = new dynamodb.Table(this, "Contacts", {
      tableName: "ApelsinContacts",
      partitionKey: { name: "email", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "contactEmail", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    contactsTable.addGlobalSecondaryIndex({
      indexName: "contactEmail-index",
      partitionKey: { name: "contactEmail", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "email", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ── S3 bucket for profile photos ──────────────────────────────────────────

    const mediaBucket = new s3.Bucket(this, "Media", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT],
          allowedOrigins: ["*"],
          allowedHeaders: ["*"],
          maxAge: 86400,
        },
      ],
    });

    const deviceSessionsTable = new dynamodb.Table(this, "DeviceSessions", {
      tableName: "ApelsinDeviceSessions",
      partitionKey: { name: "deviceToken", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "ttl",
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    deviceSessionsTable.addGlobalSecondaryIndex({
      indexName: "email-index",
      partitionKey: { name: "email", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    const pushSubscriptionsTable = new dynamodb.Table(this, "PushSubscriptions", {
      tableName: "ApelsinPushSubscriptions",
      partitionKey: { name: "email", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "deviceId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const pairingTable = new dynamodb.Table(this, "PairingSessions", {
      tableName: "ApelsinPairingSessions",
      partitionKey: { name: "sessionId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "ttl",
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const signalsTable = new dynamodb.Table(this, "Signals", {
      tableName: "ApelsinSignals",
      partitionKey: { name: "to", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "ttl",
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const callsTable = new dynamodb.Table(this, "Calls", {
      tableName: "ApelsinCalls",
      partitionKey: { name: "caller", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "ttl",
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    // ── WebSocket API ─────────────────────────────────────────────────────────

    const wsApi = new apigwv2.WebSocketApi(this, "WsApi", {
      apiName: "apelsin-ws",
    });

    // Optional custom domain for the WebSocket API.
    // The ACM cert is created with DNS validation; add the validation CNAME
    // to Cloudflare DNS, then once issued, add a CNAME for WS_DOMAIN_NAME
    // pointing to the regionalDomainName output (DNS-only / grey cloud).
    const wsDomainName = process.env.WS_DOMAIN_NAME;

    let wsDomain: apigwv2.DomainName | undefined;
    if (wsDomainName) {
      const wsCertificate = new acm.Certificate(this, "WsCertificate", {
        domainName: wsDomainName,
        validation: acm.CertificateValidation.fromDns(),
      });

      wsDomain = new apigwv2.DomainName(this, "WsDomainName", {
        domainName: wsDomainName,
        certificate: wsCertificate,
      });
    }

    const wsStage = new apigwv2.WebSocketStage(this, "WsStage", {
      webSocketApi: wsApi,
      stageName: "prod",
      autoDeploy: true,
      ...(wsDomain && {
        domainMapping: {
          domainName: wsDomain,
        },
      }),
    });

    // ── HTTP API ──────────────────────────────────────────────────────────────

    const httpApi = new apigwv2.HttpApi(this, "HttpApi", {
      apiName: "apelsin-http",
      corsPreflight: {
        allowOrigins: ["*"],
        allowMethods: [apigwv2.CorsHttpMethod.ANY],
        allowHeaders: ["Content-Type", "Authorization", "X-Device-Id", "X-User-Email"],
        maxAge: cdk.Duration.days(1),
      },
    });

    // API Gateway throttling — returns 429 before invoking Lambda
    (httpApi.defaultStage!.node.defaultChild as apigwv2.CfnStage).defaultRouteSettings = {
      throttlingBurstLimit: 50,
      throttlingRateLimit: 25,
    };

    // ── Media API (separate gateway for media serving) ───────────────────────

    const mediaApi = new apigwv2.HttpApi(this, "MediaApi", {
      apiName: "apelsin-media",
      corsPreflight: {
        allowOrigins: ["*"],
        allowMethods: [apigwv2.CorsHttpMethod.GET],
        allowHeaders: ["Content-Type", "Authorization", "X-Device-Id", "X-User-Email"],
        maxAge: cdk.Duration.days(365),
      },
    });

    (mediaApi.defaultStage!.node.defaultChild as apigwv2.CfnStage).defaultRouteSettings = {
      throttlingBurstLimit: 100,
      throttlingRateLimit: 50,
    };

    // ── Shared env + helpers ──────────────────────────────────────────────────

    const commonEnv = {
      CONNECTIONS_TABLE: connectionsTable.tableName,
      MESSAGES_TABLE: messagesTable.tableName,
      USERS_TABLE: usersTable.tableName,
      SIGNALS_TABLE: signalsTable.tableName,
      WS_ENDPOINT: wsStage.callbackUrl,
      MEDIA_BUCKET: mediaBucket.bucketName,
      PUSH_SUBSCRIPTIONS_TABLE: pushSubscriptionsTable.tableName,
      PAIRING_TABLE: pairingTable.tableName,
      CONTACTS_TABLE: contactsTable.tableName,
      DEVICE_SESSIONS_TABLE: deviceSessionsTable.tableName,
      CALLS_TABLE: callsTable.tableName,
      VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY!,
      VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY!,
      VAPID_SUBJECT: process.env.VAPID_SUBJECT!,
      ORIGIN_SECRET: process.env.ORIGIN_SECRET ?? "",
    };

    const lambdaDir = path.join(__dirname, "../lambda");

    const makeFn = (id: string, entry: string, extra?: Partial<nodejs.NodejsFunctionProps>) =>
      new nodejs.NodejsFunction(this, id, {
        entry: path.join(lambdaDir, entry),
        runtime: lambda.Runtime.NODEJS_24_X,
        environment: commonEnv,
        timeout: cdk.Duration.seconds(30),
        bundling: {
          minify: true,
          sourceMap: false,
          externalModules: [],
        },
        ...extra,
      });

    // ── WebSocket Lambdas ─────────────────────────────────────────────────────

    const wsAuthorizerFn = makeFn("WsAuthorizerFn", "ws-authorizer.ts");
    deviceSessionsTable.grantReadData(wsAuthorizerFn);

    const connectFn = makeFn("ConnectFn", "ws-connect.ts");
    connectionsTable.grantReadWriteData(connectFn);
    contactsTable.grantReadData(connectFn);
    connectFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["execute-api:ManageConnections"],
        resources: [
          `arn:aws:execute-api:${this.region}:${this.account}:${wsApi.apiId}/${wsStage.stageName}/POST/@connections/*`,
        ],
      }),
    );

    const disconnectFn = makeFn("DisconnectFn", "ws-disconnect.ts");
    connectionsTable.grantReadWriteData(disconnectFn);
    usersTable.grantReadWriteData(disconnectFn);
    contactsTable.grantReadData(disconnectFn);
    callsTable.grantReadWriteData(disconnectFn);
    pushSubscriptionsTable.grantReadWriteData(disconnectFn);
    disconnectFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["execute-api:ManageConnections"],
        resources: [
          `arn:aws:execute-api:${this.region}:${this.account}:${wsApi.apiId}/${wsStage.stageName}/POST/@connections/*`,
        ],
      }),
    );

    const messageFn = makeFn("WsMessageFn", "ws-message.ts");
    connectionsTable.grantReadData(messageFn);
    contactsTable.grantReadData(messageFn);
    messageFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["execute-api:ManageConnections"],
        resources: [
          `arn:aws:execute-api:${this.region}:${this.account}:${wsApi.apiId}/${wsStage.stageName}/POST/@connections/*`,
        ],
      }),
    );

    wsApi.addRoute("$connect", {
      integration: new apigwv2_integrations.WebSocketLambdaIntegration("ConnectInt", connectFn),
      authorizer: new apigwv2_authorizers.WebSocketLambdaAuthorizer("WsAuth", wsAuthorizerFn, {
        identitySource: ["route.request.querystring.token"],
      }),
    });
    wsApi.addRoute("$disconnect", {
      integration: new apigwv2_integrations.WebSocketLambdaIntegration("DisconnectInt", disconnectFn),
    });
    wsApi.addRoute("$default", {
      integration: new apigwv2_integrations.WebSocketLambdaIntegration("DefaultInt", messageFn),
    });

    // ── HTTP Lambdas ──────────────────────────────────────────────────────────

    const messagesFn = makeFn("MessagesFn", "http-messages.ts");
    messagesTable.grantReadWriteData(messagesFn);
    connectionsTable.grantReadWriteData(messagesFn);
    pushSubscriptionsTable.grantReadWriteData(messagesFn);
    usersTable.grantReadData(messagesFn);
    deviceSessionsTable.grantReadData(messagesFn);
    messagesFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["execute-api:ManageConnections"],
        resources: [
          `arn:aws:execute-api:${this.region}:${this.account}:${wsApi.apiId}/${wsStage.stageName}/POST/@connections/*`,
        ],
      }),
    );

    const authFn = makeFn("AuthFn", "http-auth.ts");
    usersTable.grantReadWriteData(authFn);
    deviceSessionsTable.grantReadWriteData(authFn);
    pushSubscriptionsTable.grantReadWriteData(authFn);

    const usersFn = makeFn("UsersFn", "http-users.ts");
    usersTable.grantReadWriteData(usersFn);
    deviceSessionsTable.grantReadData(usersFn);
    connectionsTable.grantReadData(usersFn);
    contactsTable.grantReadData(usersFn);

    const profileFn = makeFn("ProfileFn", "http-profile.ts");
    usersTable.grantReadWriteData(profileFn);
    mediaBucket.grantReadWrite(profileFn);
    deviceSessionsTable.grantReadData(profileFn);

    const mediaFn = makeFn("MediaFn", "http-media.ts");
    mediaBucket.grantReadWrite(mediaFn);
    deviceSessionsTable.grantReadData(mediaFn);

    const pushFn = makeFn("PushFn", "http-push.ts");
    pushSubscriptionsTable.grantReadWriteData(pushFn);
    deviceSessionsTable.grantReadData(pushFn);

    const pairingFn = makeFn("PairingFn", "http-pairing.ts");
    pairingTable.grantReadWriteData(pairingFn);
    deviceSessionsTable.grantReadData(pairingFn);

    const contactsFn = makeFn("ContactsFn", "http-contacts.ts");
    contactsTable.grantReadWriteData(contactsFn);
    usersTable.grantReadData(contactsFn);
    deviceSessionsTable.grantReadData(contactsFn);

    const signalsFn = makeFn("SignalsFn", "http-signals.ts");
    signalsTable.grantReadWriteData(signalsFn);
    deviceSessionsTable.grantReadData(signalsFn);
    contactsTable.grantReadData(signalsFn);

    const callFn = makeFn("CallFn", "http-call.ts");
    callsTable.grantReadWriteData(callFn);
    connectionsTable.grantReadData(callFn);
    pushSubscriptionsTable.grantReadWriteData(callFn);
    usersTable.grantReadData(callFn);
    deviceSessionsTable.grantReadData(callFn);
    contactsTable.grantReadData(callFn);
    callFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["execute-api:ManageConnections"],
        resources: [
          `arn:aws:execute-api:${this.region}:${this.account}:${wsApi.apiId}/${wsStage.stageName}/POST/@connections/*`,
        ],
      }),
    );

    // ── HTTP routes ───────────────────────────────────────────────────────────

    const addRoute = (method: string, path: string, fn: lambda.IFunction) =>
      httpApi.addRoutes({
        path,
        methods: [method as apigwv2.HttpMethod],
        integration: new apigwv2_integrations.HttpLambdaIntegration(`${fn.node.id}Int${path}${method}`, fn),
      });

    addRoute("GET",  "/api/messages",              messagesFn);
    addRoute("POST", "/api/messages",              messagesFn);
    addRoute("PUT",  "/api/messages/reactions",   messagesFn);
    addRoute("POST", "/api/auth/register",         authFn);
    addRoute("POST", "/api/auth/login",            authFn);
    addRoute("GET",  "/api/auth/devices",          authFn);
    addRoute("DELETE", "/api/auth/devices/{deviceToken}", authFn);
    addRoute("GET",  "/api/users",                 usersFn);
    addRoute("POST", "/api/users/public-key",      usersFn);
    addRoute("GET",  "/api/users/public-key/{email}", usersFn);
    addRoute("GET",  "/api/users/status/{email}",     usersFn);
    addRoute("GET",  "/api/profile/{email}",        profileFn);
    addRoute("PUT",  "/api/profile",               profileFn);
    addRoute("POST", "/api/profile/photo-url",     profileFn);
    addRoute("POST", "/api/upload-url",            mediaFn);
    addRoute("POST", "/api/pairing",                pairingFn);
    addRoute("GET",  "/api/pairing/{sessionId}",   pairingFn);
    addRoute("POST", "/api/pairing/{sessionId}",   pairingFn);
    addRoute("POST", "/api/push/subscribe",         pushFn);
    addRoute("POST", "/api/push/unsubscribe",       pushFn);
    addRoute("POST", "/api/contacts",              contactsFn);
    addRoute("GET",  "/api/contacts",              contactsFn);
    addRoute("GET",  "/api/contacts/pending",      contactsFn);
    addRoute("PUT",  "/api/contacts/{email}",      contactsFn);
    addRoute("POST", "/api/signal",                signalsFn);
    addRoute("GET",  "/api/signal/{peerId}",       signalsFn);
    addRoute("POST", "/api/call/request",          callFn);
    addRoute("POST", "/api/call/cancel",           callFn);

    // ── Media API routes ────────────────────────────────────────────────────

    const mediaAuthFn = makeFn("MediaAuthFn", "http-media-auth.ts");
    deviceSessionsTable.grantReadData(mediaAuthFn);

    mediaApi.addRoutes({
      path: "/api/media/{proxy+}",
      methods: [apigwv2.HttpMethod.GET],
      integration: new apigwv2_integrations.HttpLambdaIntegration("MediaInt", mediaFn),
    });
    mediaApi.addRoutes({
      path: "/api/auth/verify-media",
      methods: [apigwv2.HttpMethod.POST],
      integration: new apigwv2_integrations.HttpLambdaIntegration("MediaAuthInt", mediaAuthFn),
    });

    // ── Outputs ───────────────────────────────────────────────────────────────

    new cdk.CfnOutput(this, "HttpApiUrl", {
      value: httpApi.apiEndpoint,
      description: "HTTP API base URL — set as VITE_API_BASE_URL",
    });

    new cdk.CfnOutput(this, "MediaApiUrl", {
      value: mediaApi.apiEndpoint,
      description: "Media API base URL — set as ORIGIN_HOST_NAME in apelsin-media worker",
    });

    new cdk.CfnOutput(this, "WsApiUrl", {
      value: `wss://${wsApi.apiId}.execute-api.${this.region}.amazonaws.com/${wsStage.stageName}`,
      description: "WebSocket URL — set as VITE_WS_URL",
    });

    if (wsDomain) {
      new cdk.CfnOutput(this, "WsCustomDomainTarget", {
        value: wsDomain.regionalDomainName,
        description: "Add a CNAME in Cloudflare (DNS-only) from WS_DOMAIN_NAME to this target",
      });

      new cdk.CfnOutput(this, "WsCustomDomainUrl", {
        value: `wss://${wsDomainName}`,
        description: "WebSocket custom domain URL — set as VITE_WS_URL once DNS is live",
      });
    }
  }
}
