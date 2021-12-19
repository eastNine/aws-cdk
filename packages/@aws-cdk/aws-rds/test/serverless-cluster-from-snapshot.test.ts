import '@aws-cdk/assert-internal/jest';
import { ABSENT, ResourcePart } from '@aws-cdk/assert-internal';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as kms from '@aws-cdk/aws-kms';
import * as cdk from '@aws-cdk/core';
import { DatabaseClusterEngine, DatabaseSecret, ServerlessClusterFromSnapshot, SnapshotCredentials } from '../lib';

describe('serverless cluster from snapshot', () => {
  test('create a serverless cluster from a snapshot', () => {
    const stack = testStack();
    const vpc = new ec2.Vpc(stack, 'VPC');

    // WHEN
    new ServerlessClusterFromSnapshot(stack, 'ServerlessDatabase', {
      engine: DatabaseClusterEngine.AURORA_MYSQL,
      vpc,
      snapshotIdentifier: 'my-snapshot',
    });

    // THEN
    expect(stack).toHaveResource('AWS::RDS::DBCluster', {
      Properties: {
        Engine: 'aurora-mysql',
        DBClusterParameterGroupName: 'default.aurora-mysql5.7',
        DBSubnetGroupName: {
          Ref: 'ServerlessDatabaseSubnets5643CD76',
        },
        EngineMode: 'serverless',
        SnapshotIdentifier: 'my-snapshot',
        StorageEncrypted: true,
        VpcSecurityGroupIds: [
          {
            'Fn::GetAtt': [
              'ServerlessDatabaseSecurityGroupB00D8C0F',
              'GroupId',
            ],
          },
        ],
      },
      DeletionPolicy: 'Snapshot',
      UpdateReplacePolicy: 'Snapshot',
    }, ResourcePart.CompleteDefinition);
  });

  test('can generate a new snapshot password', () => {
    const stack = testStack();
    const vpc = new ec2.Vpc(stack, 'VPC');

    // WHEN
    new ServerlessClusterFromSnapshot(stack, 'ServerlessDatabase', {
      engine: DatabaseClusterEngine.AURORA_MYSQL,
      vpc,
      snapshotIdentifier: 'mySnapshot',
      credentials: SnapshotCredentials.fromGeneratedSecret('admin', {
        excludeCharacters: '"@/\\',
      }),
    });

    // THEN
    expect(stack).toHaveResourceLike('AWS::RDS::DBCluster', {
      MasterUsername: ABSENT,
      MasterUserPassword: {
        'Fn::Join': ['', [
          '{{resolve:secretsmanager:',
          { Ref: 'ServerlessDatabaseSecret813910E98ee0a797cad8a68dbeb85f8698cdb5bb' },
          ':SecretString:password::}}',
        ]],
      },
    });
    expect(stack).toHaveResource('AWS::SecretsManager::Secret', {
      Description: {
        'Fn::Join': ['', ['Generated by the CDK for stack: ', { Ref: 'AWS::StackName' }]],
      },
      GenerateSecretString: {
        ExcludeCharacters: '\"@/\\',
        GenerateStringKey: 'password',
        PasswordLength: 30,
        SecretStringTemplate: '{"username":"admin"}',
      },
    });
  });

  test('fromGeneratedSecret with replica regions', () => {
    const stack = testStack();
    const vpc = new ec2.Vpc(stack, 'VPC');

    // WHEN
    new ServerlessClusterFromSnapshot(stack, 'ServerlessDatabase', {
      engine: DatabaseClusterEngine.AURORA_MYSQL,
      vpc,
      snapshotIdentifier: 'mySnapshot',
      credentials: SnapshotCredentials.fromGeneratedSecret('admin', {
        replicaRegions: [{ region: 'eu-west-1' }],
      }),
    });

    // THEN
    expect(stack).toHaveResource('AWS::SecretsManager::Secret', {
      ReplicaRegions: [
        {
          Region: 'eu-west-1',
        },
      ],
    });
  });

  test('throws if generating a new password without a username', () => {
    const stack = testStack();
    const vpc = new ec2.Vpc(stack, 'VPC');

    // WHEN
    expect(() => new ServerlessClusterFromSnapshot(stack, 'ServerlessDatabase', {
      engine: DatabaseClusterEngine.AURORA_MYSQL,
      vpc,
      snapshotIdentifier: 'mySnapshot',
      credentials: { generatePassword: true },
    })).toThrow(/`credentials` `username` must be specified when `generatePassword` is set to true/);
  });

  test('can set a new snapshot password from an existing SecretValue', () => {
    const stack = testStack();
    const vpc = new ec2.Vpc(stack, 'VPC');

    // WHEN
    new ServerlessClusterFromSnapshot(stack, 'ServerlessDatabase', {
      engine: DatabaseClusterEngine.AURORA_MYSQL,
      vpc,
      snapshotIdentifier: 'mySnapshot',
      credentials: SnapshotCredentials.fromPassword(cdk.SecretValue.plainText('mysecretpassword')),
    });

    // THEN
    expect(stack).toHaveResourceLike('AWS::RDS::DBCluster', {
      MasterUsername: ABSENT,
      MasterUserPassword: 'mysecretpassword',
    });
  });

  test('can set a new snapshot password from an existing Secret', () => {
    const stack = testStack();
    const vpc = new ec2.Vpc(stack, 'VPC');

    // WHEN
    const secret = new DatabaseSecret(stack, 'DBSecret', {
      username: 'admin',
      encryptionKey: new kms.Key(stack, 'PasswordKey'),
    });
    new ServerlessClusterFromSnapshot(stack, 'ServerlessDatabase', {
      engine: DatabaseClusterEngine.AURORA_MYSQL,
      vpc,
      snapshotIdentifier: 'mySnapshot',
      credentials: SnapshotCredentials.fromSecret(secret),
    });

    // THEN
    expect(stack).toHaveResourceLike('AWS::RDS::DBCluster', {
      MasterUsername: ABSENT,
      MasterUserPassword: {
        'Fn::Join': ['', ['{{resolve:secretsmanager:', { Ref: 'DBSecretD58955BC' }, ':SecretString:password::}}']],
      },
    });
  });
});

function testStack(app?: cdk.App, id?: string): cdk.Stack {
  const stack = new cdk.Stack(app, id, { env: { account: '12345', region: 'us-test-1' } });
  stack.node.setContext('availability-zones:12345:us-test-1', ['us-test-1a', 'us-test-1b']);
  return stack;
}
